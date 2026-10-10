# Local mobile API

This is a locally runnable API foundation for the Momentum app. It uses `ChallengeService` for workspace, member, goal, run, standings, and carryover rules. It does not connect to the existing Discord guild or import its data.

## Run locally

Use Node 22 or newer. Generate two independent tokens with `openssl rand -hex 32`, then put them in a JSON map from token to test account ID:

```bash
export MOMENTUM_API_USERS='{"<alice-token>":"alice","<bob-token>":"bob"}'
npm run api:start
```

Replace both placeholders with the generated tokens. The API binds `127.0.0.1:8787` by default. Set `MOMENTUM_API_HOST` and `MOMENTUM_API_PORT` to change that; exposing it to a LAN is an explicit local-demo choice. `MOMENTUM_API_DATA_FILE`, `MOMENTUM_API_INVITE_FILE`, and `MOMENTUM_API_PROOF_DIR` can override the default paths under `.tmp/`. Do not point the API at the bot's `DATA_FILE` or run two API processes on the same files.

The static tokens identify preconfigured test accounts. There is no signup, token recovery, TLS, rate limiting, or hosted identity verification. Use a managed identity provider and a concurrent database before internet deployment. Do not put tokens or screenshot base64 in logs. Proof files and JSON files are written with owner-only permissions when newly created.

## HTTP contract

All `/v1` requests require `Authorization: Bearer <token>`. Bodies are JSON with `Content-Type: application/json`. Responses are JSON except the proof image endpoint. Errors return `{ "error": "..." }`. Successful responses use 200 or 201. Authentication failures use 401; missing squad membership and unavailable proofs use 404. A reused `clientRunId` with changed content returns 409.

| Method | Path | Body | Result |
| --- | --- | --- | --- |
| GET | `/health` | - | `{ "ok": true }`, no token needed |
| GET | `/v1/me` | - | Test account ID and joined squads |
| POST | `/v1/squads` | `{ "name", "timezone", "displayName" }` | Creates a squad and joins its creator |
| POST | `/v1/squads/:id/invites` | - | New random `inviteCode` and `expiresAt` |
| POST | `/v1/squads/:id/invites/revoke` | `{ "inviteCode" }` | Revokes an invite from this squad |
| POST | `/v1/squads/join` | `{ "inviteCode", "displayName" }` | Joins the invite's squad |
| GET | `/v1/squads/:id/summary` | - | `squad`, `month`, `member`, `personal`, `group`, `leaderboard`, `runs` |
| PUT | `/v1/squads/:id/goal` | `{ "baseGoalKm" }` | Saves the signed-in member's goal and returns the effective goal |
| POST | `/v1/squads/:id/runs` | See below | Logs one proof-backed run |
| GET | `/v1/squads/:id/runs/receipt?month=YYYY-MM&clientRunId=...` | - | The signed-in member's matching run, or `{ "run": null }` |
| GET | `/v1/squads/:id/runs/:runId/proof` | - | Screenshot bytes for the uploader only |

`timezone` must be an IANA timezone such as `Australia/Sydney`. The server chooses the challenge month and current date in that timezone. On the first request after a month changes, it closes the immediately previous open month before starting the new one. A squad inactive for multiple whole months needs a later catch-up workflow.

Invites are separate from workspace IDs. A code has 128 random bits, is stored only as a SHA-256 hash, expires after 24 hours, and may be revoked by a squad member. Any member may create or revoke an invite they know. An invite does not authenticate a user; the recipient still needs a configured bearer token.

### Run submission

```json
{
  "clientRunId": "phone-run-001",
  "distanceKm": 5.25,
  "runDate": "2026-10-03",
  "note": "Morning run",
  "mimeType": "image/png",
  "proofBase64": "<standard-base64-image>"
}
```

`clientRunId` is a stable 8 to 80 character identifier generated once per mobile run and reused on retries. An identical retry returns 200 and the original run; the first accepted request returns 201. The ID is scoped to the signed-in member, squad, and month. Distance must be 0.01 to 500 km with at most two decimals. The date must be valid, in the current squad month, and no later than today in the squad timezone. Proof must be JPEG, PNG, or WebP and at most 5 MB decoded; the JSON body limit is 7 MB. OCR is not included in this API slice.

The receipt lookup works after a month closes. It lets a client resolve a lost POST response without resubmitting an old-month run. A missing receipt returns `{ "run": null }`; it never returns another member's run or proof bytes.

The response is `{ "run": { "id", "memberId", "distanceKm", "runDate", "note", "status", "acceptedAt", "hasProof" } }`. The summary includes other members' run details and standings but never proof paths or image bytes. Only the uploader can read the proof endpoint. Images are stored in a private directory, never a public static route.

The API serializes requests through one process, and its JSON repository atomically replaces the snapshot file. This supports simultaneous local requests and retry-safe submissions, but not multiple server processes or a production hosted database. Failed run persistence removes its new proof file and rolls back the in-memory submission.
