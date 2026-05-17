import { createServer, type Server } from "node:http";
import { DomainError } from "../../core/errors.js";
import type { ChallengeRepository } from "../../repositories/challengeRepository.js";
import { decodeStravaOAuthState } from "../strava/oauthState.js";
import type { StravaOAuthClient } from "../strava/stravaProvider.js";

export class StravaOAuthServer {
  private server?: Server;

  constructor(
    private readonly repository: ChallengeRepository,
    private readonly stravaClient: StravaOAuthClient,
    private readonly port: number,
    private readonly stateSecret: string,
  ) {}

  start(): void {
    if (this.server) {
      return;
    }

    this.server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url ?? "/", `http://localhost:${this.port}`);
        if (url.pathname !== "/strava/callback") {
          response.writeHead(404);
          response.end("Not found");
          return;
        }

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const scope = url.searchParams.get("scope") ?? "";
        if (!code || !state) {
          response.writeHead(400);
          response.end("Missing Strava code or state.");
          return;
        }

        const parsed = decodeStravaOAuthState(state, this.stateSecret);
        const member = await this.repository.getMemberById(parsed.memberId);
        if (!member || member.workspaceId !== parsed.workspaceId) {
          response.writeHead(400);
          response.end("Unknown runner challenge member.");
          return;
        }

        await this.stravaClient.exchangeCode({ member, code, scope });
        response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Strava connected. You can return to Discord and run /strava-sync.");
      } catch (error) {
        response.writeHead(error instanceof DomainError ? 400 : 500, { "Content-Type": "text/plain; charset=utf-8" });
        response.end(error instanceof Error ? error.message : "Unexpected Strava callback failure.");
      }
    });

    this.server.listen(this.port, () => {
      console.log(`Strava OAuth callback server listening on http://localhost:${this.port}/strava/callback`);
    });
  }

}
