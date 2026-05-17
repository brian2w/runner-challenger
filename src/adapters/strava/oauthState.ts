import { createHmac, timingSafeEqual } from "node:crypto";
import { DomainError } from "../../core/errors.js";

export interface StravaOAuthState {
  workspaceId: string;
  memberId: string;
}

export function encodeStravaOAuthState(state: StravaOAuthState, secret: string): string {
  const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function decodeStravaOAuthState(value: string, secret: string): StravaOAuthState {
  const [payload, signature] = value.split(".");
  if (!payload || !signature) {
    throw new DomainError("Invalid Strava OAuth state.");
  }

  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (signature.length !== expected.length) {
    throw new DomainError("Invalid Strava OAuth state signature.");
  }
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new DomainError("Invalid Strava OAuth state signature.");
  }

  let state: Partial<StravaOAuthState>;
  try {
    state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<StravaOAuthState>;
  } catch {
    throw new DomainError("Invalid Strava OAuth state payload.");
  }
  if (!state.workspaceId || !state.memberId) {
    throw new DomainError("Invalid Strava OAuth state payload.");
  }
  return {
    workspaceId: state.workspaceId,
    memberId: state.memberId,
  };
}
