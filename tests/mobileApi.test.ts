import { deepEqual, equal, match, notEqual, ok, throws } from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { JsonInviteStore } from "../src/mobileApi/inviteStore.js";
import { createMobileApi, parseApiUsers } from "../src/mobileApi/mobileApi.js";
import { JsonFileChallengeRepository } from "../src/repositories/jsonFileChallengeRepository.js";

const ALICE_TOKEN = "a".repeat(32);
const BOB_TOKEN = "b".repeat(32);
const CHARLIE_TOKEN = "c".repeat(32);
const PROOF_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+K26iAAAAAElFTkSuQmCC";

type TestApi = {
  baseUrl: string;
  repository: JsonFileChallengeRepository;
  close: () => Promise<void>;
};

async function startApi(directory: string, clock: () => Date): Promise<TestApi> {
  const repository = new JsonFileChallengeRepository(join(directory, "challenge.json"));
  await repository.init();
  const inviteStore = new JsonInviteStore(join(directory, "invites.json"));
  await inviteStore.init();
  const server = createMobileApi({
    repository,
    inviteStore,
    proofDirectory: join(directory, "proofs"),
    users: new Map([[ALICE_TOKEN, "alice"], [BOB_TOKEN, "bob"], [CHARLIE_TOKEN, "charlie"]]),
    now: clock,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP address.");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    repository,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function request(api: TestApi, token: string | null, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${api.baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("mobile API", () => {
  it("requires configured tokens and creates private squads in their timezone", async () => {
    throws(() => parseApiUsers(undefined), /MOMENTUM_API_USERS/);
    throws(() => parseApiUsers('{"short":"alice"}'), /invalid token/);
    const directory = await mkdtemp(join(tmpdir(), "momentum-mobile-api-"));
    const api = await startApi(directory, () => new Date("2026-09-30T14:30:00Z"));
    try {
      equal((await request(api, null, "GET", "/health")).status, 200);
      equal((await request(api, null, "GET", "/v1/me")).status, 401);
      const created = await request(api, ALICE_TOKEN, "POST", "/v1/squads", { name: "Morning Crew", timezone: "Australia/Sydney", displayName: "Alice" });
      equal(created.status, 201);
      const { squad } = await created.json() as { squad: { id: string; createdAt: string } };
      equal(squad.createdAt, "2026-09-30T14:30:00.000Z");
      const summary = await request(api, ALICE_TOKEN, "GET", `/v1/squads/${encodeURIComponent(squad.id)}/summary`);
      equal(summary.status, 200);
      equal(((await summary.json()) as { month: string }).month, "2026-10");
      equal((await request(api, BOB_TOKEN, "GET", `/v1/squads/${encodeURIComponent(squad.id)}/summary`)).status, 404);
      const invite = await request(api, ALICE_TOKEN, "POST", `/v1/squads/${encodeURIComponent(squad.id)}/invites`);
      equal(invite.status, 201);
      const { inviteCode } = await invite.json() as { inviteCode: string };
      notEqual(inviteCode, squad.id);
      equal((await request(api, BOB_TOKEN, "POST", "/v1/squads/join", { inviteCode, displayName: "Bob" })).status, 200);
      const me = await request(api, BOB_TOKEN, "GET", "/v1/me");
      deepEqual(((await me.json()) as { squads: { id: string }[] }).squads.map((entry) => entry.id), [squad.id]);
      equal((await request(api, CHARLIE_TOKEN, "POST", "/v1/squads/join", { inviteCode: squad.id, displayName: "Charlie" })).status, 404);
    } finally {
      await api.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("persists idempotent runs and only serves proofs to the uploader", async () => {
    const directory = await mkdtemp(join(tmpdir(), "momentum-mobile-api-"));
    let api = await startApi(directory, () => new Date("2026-10-04T02:00:00Z"));
    try {
      const created = await request(api, ALICE_TOKEN, "POST", "/v1/squads", { name: "Squad", timezone: "Australia/Sydney", displayName: "Alice" });
      const { squad } = await created.json() as { squad: { id: string } };
      const squadPath = `/v1/squads/${encodeURIComponent(squad.id)}`;
      const invite = await request(api, ALICE_TOKEN, "POST", `${squadPath}/invites`);
      const { inviteCode } = await invite.json() as { inviteCode: string };
      equal((await request(api, BOB_TOKEN, "POST", "/v1/squads/join", { inviteCode, displayName: "Bob" })).status, 200);
      equal((await request(api, ALICE_TOKEN, "PUT", `${squadPath}/goal`, { baseGoalKm: 100 })).status, 200);
      equal((await request(api, BOB_TOKEN, "PUT", `${squadPath}/goal`, { baseGoalKm: 50 })).status, 200);
      const body = { clientRunId: "run-alice-001", distanceKm: 5.25, runDate: "2026-10-03", note: "Morning run", mimeType: "image/png", proofBase64: PROOF_BASE64 };
      const [logged, concurrentRetry] = await Promise.all([
        request(api, ALICE_TOKEN, "POST", `${squadPath}/runs`, body),
        request(api, ALICE_TOKEN, "POST", `${squadPath}/runs`, body),
      ]);
      deepEqual([logged.status, concurrentRetry.status].sort(), [200, 201]);
      const { run } = await logged.json() as { run: { id: string; acceptedAt: string } };
      equal(run.acceptedAt, "2026-10-04T02:00:00.000Z");
      equal((await request(api, ALICE_TOKEN, "POST", `${squadPath}/runs`, body)).status, 200);
      equal((await request(api, ALICE_TOKEN, "POST", `${squadPath}/runs`, { ...body, distanceKm: 6 })).status, 409);
      equal((await request(api, ALICE_TOKEN, "POST", `${squadPath}/runs`, { ...body, clientRunId: "run-future-001", runDate: "2026-10-05" })).status, 400);
      const proofPath = `${squadPath}/runs/${run.id}/proof`;
      equal((await request(api, BOB_TOKEN, "GET", proofPath)).status, 404);
      const proof = await request(api, ALICE_TOKEN, "GET", proofPath);
      equal(proof.status, 200);
      equal(proof.headers.get("content-type"), "image/png");
      deepEqual(Buffer.from(await proof.arrayBuffer()), Buffer.from(PROOF_BASE64, "base64"));
      const summary = await request(api, BOB_TOKEN, "GET", `${squadPath}/summary`);
      const snapshot = await summary.json() as { group: { completedKm: number }; runs: { id: string }[] };
      equal(snapshot.group.completedKm, 5.25);
      equal(snapshot.runs.length, 1);
      ok(!JSON.stringify(snapshot).includes("mobile-proof:"));
      await api.close();
      api = await startApi(directory, () => new Date("2026-10-04T02:00:00Z"));
      equal((await request(api, ALICE_TOKEN, "POST", `${squadPath}/runs`, body)).status, 200);
      equal((await request(api, ALICE_TOKEN, "GET", proofPath)).status, 200);
      const persisted = await readFile(join(directory, "challenge.json"), "utf8");
      match(persisted, /Morning run/);
    } finally {
      await api.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("revokes and expires invite codes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "momentum-mobile-api-"));
    let clock = new Date("2026-10-04T02:00:00Z");
    let api = await startApi(directory, () => clock);
    try {
      const created = await request(api, ALICE_TOKEN, "POST", "/v1/squads", { name: "Squad", timezone: "Australia/Sydney", displayName: "Alice" });
      const { squad } = await created.json() as { squad: { id: string } };
      const path = `/v1/squads/${encodeURIComponent(squad.id)}/invites`;
      const first = await request(api, ALICE_TOKEN, "POST", path, { clientInviteId: "invite-alice-001" });
      equal(first.status, 201);
      const issued = await first.json() as { inviteCode: string; expiresAt: string };
      const { inviteCode: revokedCode } = issued;
      const retry = await request(api, ALICE_TOKEN, "POST", path, { clientInviteId: "invite-alice-001" });
      equal(retry.status, 200);
      deepEqual(await retry.json(), issued);
      await api.close();
      api = await startApi(directory, () => clock);
      const afterRestart = await request(api, ALICE_TOKEN, "POST", path, { clientInviteId: "invite-alice-001" });
      equal(afterRestart.status, 200);
      deepEqual(await afterRestart.json(), issued);
      equal((await request(api, ALICE_TOKEN, "POST", path, {})).status, 201);
      equal((await fetch(`${api.baseUrl}${path}`, { method: "POST", headers: { Authorization: `Bearer ${ALICE_TOKEN}`, "Content-Type": "application/json" } })).status, 201);
      equal((await request(api, ALICE_TOKEN, "POST", path, { clientInviteId: "short" })).status, 400);
      equal((await request(api, BOB_TOKEN, "POST", `${path}/revoke`, { inviteCode: revokedCode })).status, 404);
      equal((await request(api, ALICE_TOKEN, "POST", `${path}/revoke`, { inviteCode: revokedCode })).status, 200);
      equal((await request(api, ALICE_TOKEN, "POST", path, { clientInviteId: "invite-alice-001" })).status, 409);
      equal((await request(api, BOB_TOKEN, "POST", "/v1/squads/join", { inviteCode: revokedCode, displayName: "Bob" })).status, 404);
      const second = await request(api, ALICE_TOKEN, "POST", path, { clientInviteId: "invite-alice-002" });
      const { inviteCode: expiredCode } = await second.json() as { inviteCode: string };
      clock = new Date(clock.getTime() + 24 * 60 * 60 * 1000);
      equal((await request(api, ALICE_TOKEN, "POST", path, { clientInviteId: "invite-alice-002" })).status, 409);
      equal((await request(api, BOB_TOKEN, "POST", "/v1/squads/join", { inviteCode: expiredCode, displayName: "Bob" })).status, 404);
    } finally {
      await api.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not accept a run whose repository write failed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "momentum-mobile-api-"));
    const api = await startApi(directory, () => new Date("2026-10-04T02:00:00Z"));
    try {
      const created = await request(api, ALICE_TOKEN, "POST", "/v1/squads", { name: "Squad", timezone: "Australia/Sydney", displayName: "Alice" });
      const { squad } = await created.json() as { squad: { id: string } };
      const path = `/v1/squads/${encodeURIComponent(squad.id)}/runs`;
      const body = { clientRunId: "run-failure-001", distanceKm: 5, runDate: "2026-10-03", mimeType: "image/png", proofBase64: PROOF_BASE64 };
      const blocker = join(directory, "challenge.json.writing");
      const saveSubmission = api.repository.saveSubmission.bind(api.repository);
      let failOnce = true;
      api.repository.saveSubmission = async (submission) => {
        if (!failOnce) return saveSubmission(submission);
        failOnce = false;
        await mkdir(blocker);
        try {
          await saveSubmission(submission);
        } finally {
          await rm(blocker, { recursive: true });
        }
      };
      equal((await request(api, ALICE_TOKEN, "POST", path, body)).status, 500);
      deepEqual(await readdir(join(directory, "proofs")), []);
      equal((await request(api, ALICE_TOKEN, "POST", path, body)).status, 201);
    } finally {
      await api.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("closes the previous month before an invitee joins and applies carryover", async () => {
    const directory = await mkdtemp(join(tmpdir(), "momentum-mobile-api-"));
    let clock = new Date("2026-09-30T12:00:00Z");
    const api = await startApi(directory, () => clock);
    try {
      const created = await request(api, ALICE_TOKEN, "POST", "/v1/squads", { name: "Squad", timezone: "Australia/Sydney", displayName: "Alice" });
      const { squad, member } = await created.json() as { squad: { id: string }; member: { id: string } };
      const path = `/v1/squads/${encodeURIComponent(squad.id)}`;
      equal((await request(api, ALICE_TOKEN, "PUT", `${path}/goal`, { baseGoalKm: 10 })).status, 200);
      const invite = await request(api, ALICE_TOKEN, "POST", `${path}/invites`);
      const { inviteCode } = await invite.json() as { inviteCode: string };
      clock = new Date("2026-09-30T15:00:00Z");
      equal((await request(api, BOB_TOKEN, "POST", "/v1/squads/join", { inviteCode, displayName: "Bob" })).status, 200);
      const summary = await request(api, ALICE_TOKEN, "GET", `${path}/summary`);
      equal(((await summary.json()) as { month: string }).month, "2026-10");
      const previous = await api.repository.getChallengeByMonth(squad.id, "2026-09");
      equal(previous?.closedAt, "2026-09-30T15:00:00.000Z");
      deepEqual((await api.repository.listMonthlyResultsByChallenge(previous!.id)).map((result) => result.memberId), [member.id]);
      equal((await api.repository.getChallengeByMonth(squad.id, "2026-10"))?.createdAt, "2026-09-30T15:00:00.000Z");
      const goal = await request(api, ALICE_TOKEN, "PUT", `${path}/goal`, { baseGoalKm: 10 });
      const effective = await goal.json() as { carryoverKm: number; effectiveGoalKm: number };
      equal(effective.carryoverKm, 11.5);
      equal(effective.effectiveGoalKm, 21.5);
    } finally {
      await api.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
