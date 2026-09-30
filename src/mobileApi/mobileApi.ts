import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { createMonthKey, createMonthKeyForDate, parseMonthKey } from "../core/time.js";
import { DomainError } from "../core/errors.js";
import { systemMomentumRuntime } from "../core/runtime.js";
import type { Member, MonthKey, RunSubmission, Workspace } from "../core/types.js";
import type { ChallengeRepository } from "../repositories/challengeRepository.js";
import { ChallengeService } from "../services/challengeService.js";
import { hashInviteCode, type InviteStore } from "./inviteStore.js";

const MAX_JSON_BYTES = 7 * 1024 * 1024;
const MAX_PROOF_BYTES = 5 * 1024 * 1024;
const INVITE_LIFETIME_MS = 24 * 60 * 60 * 1000;
const MOBILE_PLATFORM = "momentum_mobile";

class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type JsonObject = Record<string, unknown>;

export type MobileApiOptions = {
  repository: ChallengeRepository;
  inviteStore: InviteStore;
  proofDirectory: string;
  users: ReadonlyMap<string, string>;
  now?: () => Date;
};

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(value));
}

function requiredString(body: JsonObject, key: string, maxLength: number): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new ApiError(400, `${key} is required and must be at most ${maxLength} characters.`);
  }
  return value.trim();
}

function requiredDistance(body: JsonObject, key: string): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0.01 || value > 500 || Math.abs(Math.round(value * 100) - value * 100) > 1e-7) {
    throw new ApiError(400, `${key} must be between 0.01 and 500 km with at most two decimal places.`);
  }
  return value;
}

function timezoneDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function validTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

async function readJson(request: IncomingMessage): Promise<JsonObject> {
  if (!request.headers["content-type"]?.startsWith("application/json")) {
    throw new ApiError(415, "Content-Type must be application/json.");
  }
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
    throw new ApiError(413, "Request body is too large.");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > MAX_JSON_BYTES) throw new ApiError(413, "Request body is too large.");
    chunks.push(bytes);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(400, "Request body must be valid JSON.");
  }
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new ApiError(400, "Request body must be an object.");
  }
  return value as JsonObject;
}

function proofBytes(body: JsonObject): { bytes: Buffer; extension: string; contentType: string } {
  const mimeType = requiredString(body, "mimeType", 30);
  const formats: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  const extension = formats[mimeType];
  if (!extension) throw new ApiError(400, "Proof must be a JPEG, PNG, or WebP image.");
  const encoded = body.proofBase64;
  if (typeof encoded !== "string" || encoded.length > Math.ceil(MAX_PROOF_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new ApiError(400, "proofBase64 must be a base64 image under 5 MB.");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length || bytes.length > MAX_PROOF_BYTES || bytes.toString("base64") !== encoded) {
    throw new ApiError(400, "proofBase64 must be a base64 image under 5 MB.");
  }
  const valid = mimeType === "image/png"
    ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mimeType === "image/jpeg"
      ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
      : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (!valid) throw new ApiError(400, "Proof image does not match mimeType.");
  return { bytes, extension, contentType: mimeType };
}

function publicRun(run: RunSubmission): JsonObject {
  return {
    id: run.id,
    memberId: run.memberId,
    distanceKm: run.distanceKm,
    runDate: run.runDate,
    note: run.userNote ?? "",
    status: run.status,
    acceptedAt: run.acceptedAt,
    hasProof: Boolean(run.evidenceUrl),
  };
}

export function createMobileApi(options: MobileApiOptions) {
  const now = options.now ?? (() => new Date());
  const service = new ChallengeService(options.repository, {
    createId: systemMomentumRuntime.createId,
    now: () => now().toISOString(),
  });
  const preparedMonths = new Set<string>();
  let queue: Promise<void> = Promise.resolve();

  function actorFor(request: IncomingMessage): { actor: string; token: string } {
    const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(request.headers.authorization ?? "");
    if (!match) throw new ApiError(401, "Bearer token required.");
    const supplied = Buffer.from(match[1]);
    for (const [token, accountId] of options.users) {
      const candidate = Buffer.from(token);
      if (candidate.length === supplied.length && timingSafeEqual(candidate, supplied)) return { actor: accountId, token: match[1] };
    }
    throw new ApiError(401, "Invalid bearer token.");
  }

  async function membership(workspaceId: string, actor: string): Promise<{ workspace: Workspace; member: Member }> {
    const identity = await options.repository.getMemberIdentity(workspaceId, MOBILE_PLATFORM, actor);
    const member = identity && await options.repository.getMemberById(identity.memberId);
    const workspace = await options.repository.getWorkspaceById(workspaceId);
    if (!identity || !member || !workspace || member.workspaceId !== workspaceId) {
      throw new ApiError(404, "Squad not found.");
    }
    return { workspace, member };
  }

  async function ensureMonth(workspace: Workspace): Promise<MonthKey> {
    const month = createMonthKeyForDate(now(), workspace.timezone);
    const { year, monthOneIndexed } = parseMonthKey(month);
    const previous = monthOneIndexed === 1 ? createMonthKey(year - 1, 12) : createMonthKey(year, monthOneIndexed - 1);
    const previousChallenge = await options.repository.getChallengeByMonth(workspace.id, previous);
    if (previousChallenge?.status === "open") {
      await service.closeMonth({ workspaceId: workspace.id, month: previous });
    }
    const key = `${workspace.id}:${month}`;
    if (!preparedMonths.has(key)) {
      await service.startMonth({ workspaceId: workspace.id, month });
      preparedMonths.add(key);
    }
    return month;
  }

  async function summary(workspace: Workspace, member: Member): Promise<JsonObject> {
    const month = await ensureMonth(workspace);
    const [snapshot, group] = await Promise.all([
      service.getMonthlySummary({ workspaceId: workspace.id, month }),
      service.getGroupProgress({ workspaceId: workspace.id, month }),
    ]);
    const statuses = await service.getMemberStatuses(workspace.id, snapshot.challenge.id);
    return {
      squad: workspace,
      month,
      member: { id: member.id, displayName: member.displayName },
      personal: statuses.find((status) => status.memberId === member.id),
      group,
      leaderboard: snapshot.leaderboard,
      runs: snapshot.submissions.filter((run) => run.status !== "removed").map(publicRun).sort((a, b) => String(b.acceptedAt).localeCompare(String(a.acceptedAt))),
    };
  }

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");
    const path = url.pathname.split("/").filter(Boolean);
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { ok: true });
      return;
    }
    const { actor, token } = actorFor(request);
    if (request.method === "GET" && url.pathname === "/v1/me") {
      const squads = [];
      for (const workspace of await options.repository.listWorkspaces()) {
        const identity = await options.repository.getMemberIdentity(workspace.id, MOBILE_PLATFORM, actor);
        const member = identity && await options.repository.getMemberById(identity.memberId);
        if (member) squads.push({ id: workspace.id, name: workspace.name, timezone: workspace.timezone, memberId: member.id, displayName: member.displayName });
      }
      sendJson(response, 200, { accountId: actor, squads });
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/squads") {
      const body = await readJson(request);
      const name = requiredString(body, "name", 60);
      const timezone = requiredString(body, "timezone", 80);
      const displayName = requiredString(body, "displayName", 40);
      if (!validTimezone(timezone)) throw new ApiError(400, "timezone must be a valid IANA timezone.");
      const workspace = await service.createWorkspace({ name, timezone });
      const member = await service.registerMember({ workspaceId: workspace.id, displayName, platform: MOBILE_PLATFORM, externalUserId: actor });
      await ensureMonth(workspace);
      sendJson(response, 201, { squad: workspace, member: { id: member.id, displayName: member.displayName } });
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/squads/join") {
      const body = await readJson(request);
      const inviteCode = requiredString(body, "inviteCode", 40);
      const displayName = requiredString(body, "displayName", 40);
      const invitation = await options.inviteStore.get(inviteCode);
      if (!invitation || invitation.revokedAt || !Number.isFinite(Date.parse(invitation.expiresAt)) || now().getTime() >= Date.parse(invitation.expiresAt)) {
        throw new ApiError(404, "Invite not found or expired.");
      }
      const workspace = await options.repository.getWorkspaceById(invitation.workspaceId);
      if (!workspace) throw new ApiError(404, "Invite not found or expired.");
      await ensureMonth(workspace);
      const member = await service.registerMember({ workspaceId: workspace.id, displayName, platform: MOBILE_PLATFORM, externalUserId: actor });
      sendJson(response, 200, { squad: workspace, member: { id: member.id, displayName: member.displayName } });
      return;
    }
    if (path.length < 3 || path[0] !== "v1" || path[1] !== "squads") throw new ApiError(404, "Route not found.");
    const workspaceId = path[2];
    const { workspace, member } = await membership(workspaceId, actor);
    if (request.method === "POST" && path.length === 4 && path[3] === "invites") {
      const clientInviteId = request.headers["content-type"]?.startsWith("application/json")
        ? requiredString(await readJson(request), "clientInviteId", 80) : null;
      if (clientInviteId && !/^[A-Za-z0-9_-]{8,80}$/.test(clientInviteId)) {
        throw new ApiError(400, "clientInviteId must use 8 to 80 letters, digits, hyphens, or underscores.");
      }
      const inviteCode = clientInviteId
        ? createHmac("sha256", token).update(JSON.stringify(["momentum-invite-v1", actor, workspaceId, clientInviteId])).digest().subarray(0, 16).toString("base64url")
        : randomBytes(16).toString("base64url");
      const existing = await options.inviteStore.get(inviteCode);
      if (existing) {
        if (existing.workspaceId !== workspaceId || existing.revokedAt || now().getTime() >= Date.parse(existing.expiresAt)) {
          throw new ApiError(409, "This invite request has expired or been revoked. Start a new invite.");
        }
        sendJson(response, 200, { inviteCode, expiresAt: existing.expiresAt });
        return;
      }
      const expiresAt = new Date(now().getTime() + INVITE_LIFETIME_MS).toISOString();
      await options.inviteStore.save({ codeHash: hashInviteCode(inviteCode), workspaceId, expiresAt });
      sendJson(response, 201, { inviteCode, expiresAt });
      return;
    }
    if (request.method === "POST" && path.length === 5 && path[3] === "invites" && path[4] === "revoke") {
      const body = await readJson(request);
      const inviteCode = requiredString(body, "inviteCode", 40);
      const revoked = await options.inviteStore.revoke(inviteCode, workspaceId, now().toISOString());
      if (!revoked) throw new ApiError(404, "Invite not found.");
      sendJson(response, 200, { revoked: true });
      return;
    }
    if (request.method === "GET" && path.length === 4 && path[3] === "summary") {
      sendJson(response, 200, await summary(workspace, member));
      return;
    }
    if (request.method === "PUT" && path.length === 4 && path[3] === "goal") {
      const body = await readJson(request);
      const baseGoalKm = requiredDistance(body, "baseGoalKm");
      const goal = await service.setGoal({ workspaceId, month: await ensureMonth(workspace), memberId: member.id, baseGoalKm });
      sendJson(response, 200, goal);
      return;
    }
    if (request.method === "POST" && path.length === 4 && path[3] === "runs") {
      const body = await readJson(request);
      const clientRunId = requiredString(body, "clientRunId", 80);
      if (!/^[A-Za-z0-9_-]{8,80}$/.test(clientRunId)) throw new ApiError(400, "clientRunId must use 8 to 80 letters, digits, hyphens, or underscores.");
      const distanceKm = requiredDistance(body, "distanceKm");
      const runDate = requiredString(body, "runDate", 10);
      if (runDate > timezoneDate(now(), workspace.timezone)) throw new ApiError(400, "runDate cannot be in the future.");
      const note = body.note === undefined ? "" : body.note;
      if (typeof note !== "string" || note.length > 60) throw new ApiError(400, "note must be at most 60 characters.");
      const { bytes, extension } = proofBytes(body);
      const month = await ensureMonth(workspace);
      const challenge = (await options.repository.getChallengeByMonth(workspaceId, month))!;
      const digest = createHash("sha256").update(JSON.stringify([workspaceId, member.id, month, clientRunId])).digest("hex");
      const existing = (await options.repository.listSubmissionsByChallenge(challenge.id)).find((run) => run.memberId === member.id && run.evidenceUrl?.startsWith(`mobile-proof:${digest}.`));
      if (existing) {
        const priorName = existing.evidenceUrl!.slice("mobile-proof:".length);
        const priorBytes = await readFile(join(options.proofDirectory, priorName));
        if (existing.distanceKm !== distanceKm || existing.runDate !== runDate || (existing.userNote ?? "") !== note || !priorBytes.equals(bytes)) {
          throw new ApiError(409, "clientRunId was already used for a different run.");
        }
        sendJson(response, 200, { run: publicRun(existing) });
        return;
      }
      const fileName = `${digest}.${extension}`;
      await mkdir(options.proofDirectory, { recursive: true, mode: 0o700 });
      try {
        await writeFile(join(options.proofDirectory, fileName), bytes, { mode: 0o600 });
        const run = await service.submitRunProof({ workspaceId, month, memberId: member.id, distanceKm, runDate, evidenceUrl: `mobile-proof:${fileName}`, evidenceLabel: "Private screenshot", userNote: note });
        sendJson(response, 201, { run: publicRun(run) });
      } catch (error) {
        await unlink(join(options.proofDirectory, fileName)).catch(() => undefined);
        throw error;
      }
      return;
    }
    if (request.method === "GET" && path.length === 6 && path[3] === "runs" && path[5] === "proof") {
      const run = await options.repository.getSubmissionById(path[4]);
      if (!run || run.workspaceId !== workspaceId || run.memberId !== member.id || !run.evidenceUrl?.startsWith("mobile-proof:")) {
        throw new ApiError(404, "Proof not found.");
      }
      const fileName = run.evidenceUrl.slice("mobile-proof:".length);
      if (!/^[a-f0-9]{64}\.(jpg|png|webp)$/.test(fileName)) throw new ApiError(404, "Proof not found.");
      let bytes: Buffer;
      try {
        bytes = await readFile(join(options.proofDirectory, fileName));
      } catch {
        throw new ApiError(404, "Proof not found.");
      }
      const contentType = fileName.endsWith(".png") ? "image/png" : fileName.endsWith(".webp") ? "image/webp" : "image/jpeg";
      response.writeHead(200, { "Content-Type": contentType, "Content-Length": bytes.length, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
      response.end(bytes);
      return;
    }
    throw new ApiError(404, "Route not found.");
  }

  return createServer((request, response) => {
    const next = queue.then(() => route(request, response));
    queue = next.then(() => undefined, () => undefined);
    next.catch((error: unknown) => {
      const status = error instanceof ApiError ? error.status : error instanceof DomainError ? 400 : 500;
      const message = status === 500 ? "Internal server error." : (error as Error).message;
      if (status === 500) process.stderr.write("Mobile API request failed.\n");
      if (!response.headersSent) sendJson(response, status, { error: message });
      else response.end();
    });
  });
}

export function parseApiUsers(value: string | undefined): Map<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value ?? "");
  } catch {
    throw new Error("MOMENTUM_API_USERS must be a JSON object mapping tokens to account IDs.");
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("MOMENTUM_API_USERS must be a JSON object mapping tokens to account IDs.");
  }
  const users = new Map<string, string>();
  for (const [token, accountId] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9_-]{32,}$/.test(token) || typeof accountId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(accountId)) {
      throw new Error("MOMENTUM_API_USERS contains an invalid token or account ID.");
    }
    users.set(token, accountId);
  }
  if (!users.size) throw new Error("MOMENTUM_API_USERS must contain at least one account.");
  return users;
}
