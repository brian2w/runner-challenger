import { createHmac, timingSafeEqual } from "node:crypto";
import { DomainError } from "../../core/errors.js";

export interface StravaOAuthState {
  workspaceId: string;
  memberId: string;
}

const base64UrlPattern = /^[A-Za-z0-9_-]+$/;

export function encodeStravaOAuthState(state: StravaOAuthState, secret: string): string {
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function decodeStravaOAuthState(value: string, secret: string): StravaOAuthState {
  const parts = value.split(".");
  if (parts.length !== 2) {
    throw new DomainError("Invalid Strava OAuth state.");
  }

  const [payload, signature] = parts;
  if (!payload || !signature) {
    throw new DomainError("Invalid Strava OAuth state.");
  }
  if (!base64UrlPattern.test(payload) || !base64UrlPattern.test(signature)) {
    throw new DomainError("Invalid Strava OAuth state.");
  }

  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const signatureBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (signatureBuffer.length !== expectedBuffer.length) {
    throw new DomainError("Invalid Strava OAuth state signature.");
  }
  if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
    throw new DomainError("Invalid Strava OAuth state signature.");
  }

  let state: unknown;
  try {
    state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown;
  } catch {
    throw new DomainError("Invalid Strava OAuth state payload.");
  }
  if (
    typeof state !== "object" ||
    state === null ||
    !("workspaceId" in state) ||
    !("memberId" in state) ||
    typeof state.workspaceId !== "string" ||
    typeof state.memberId !== "string" ||
    state.workspaceId.length === 0 ||
    state.memberId.length === 0
  ) {
    throw new DomainError("Invalid Strava OAuth state payload.");
  }
  return {
    workspaceId: state.workspaceId,
    memberId: state.memberId,
  };
}
