import { randomUUID } from "node:crypto";
import { DomainError } from "../../core/errors.js";
import { monthStartIso, nextMonth, nowIso, parseMonthInput } from "../../core/time.js";
import type { Member, StravaActivity, StravaConnection } from "../../core/types.js";
import type { ChallengeRepository } from "../../repositories/challengeRepository.js";

export interface StravaProvider {
  listActivities(athleteId: string, month: string): Promise<StravaActivity[]>;
}

export class FakeStravaProvider implements StravaProvider {
  constructor(private readonly activitiesByAthlete = new Map<string, StravaActivity[]>()) {}

  async listActivities(athleteId: string): Promise<StravaActivity[]> {
    return this.activitiesByAthlete.get(athleteId) ?? [];
  }
}

interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope?: string;
  athlete?: {
    id?: number;
  };
}

interface StravaSummaryActivity {
  id: number;
  type?: string;
  sport_type?: string;
  distance?: number;
  start_date_local?: string;
  start_date?: string;
}

const STRAVA_RUN_SPORT_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);

function hasActivityReadScope(scope: string): boolean {
  const scopes = new Set(scope.split(/[,\s]+/).filter(Boolean));
  return scopes.has("activity:read") || scopes.has("activity:read_all");
}

export class StravaOAuthClient implements StravaProvider {
  constructor(
    private readonly repository: ChallengeRepository,
    private readonly config: {
      clientId: string;
      clientSecret: string;
      redirectUri: string;
    },
  ) {}

  buildAuthorizeUrl(state: string): string {
    const url = new URL("https://www.strava.com/oauth/authorize");
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("approval_prompt", "auto");
    url.searchParams.set("scope", "activity:read");
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeCode(input: { member: Member; code: string; scope: string }): Promise<StravaConnection> {
    const token = await this.requestToken({
      grant_type: "authorization_code",
      code: input.code,
    });
    const athleteId = token.athlete?.id?.toString();
    if (!athleteId) {
      throw new DomainError("Strava did not return an athlete id.");
    }
    const acceptedScope = token.scope ?? input.scope;
    if (!hasActivityReadScope(acceptedScope)) {
      throw new DomainError("Strava connection requires the activity:read scope.");
    }

    const connection: StravaConnection = {
      id: randomUUID(),
      workspaceId: input.member.workspaceId,
      memberId: input.member.id,
      athleteId,
      scope: acceptedScope,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_at,
      updatedAt: nowIso(),
    };

    await this.repository.saveMember({
      ...input.member,
      connectedStravaAthleteId: athleteId,
    });
    await this.repository.saveStravaConnection(connection);
    return connection;
  }

  async listActivities(athleteId: string, month: string): Promise<StravaActivity[]> {
    const connection = await this.findConnectionByAthleteId(athleteId);
    if (!connection) {
      throw new DomainError("No Strava connection was found for that athlete.");
    }

    const accessToken = await this.getAccessToken(connection);
    const monthKey = parseMonthInput(month);
    const after = Math.floor(new Date(monthStartIso(monthKey)).getTime() / 1000).toString();
    const before = Math.floor(new Date(monthStartIso(nextMonth(monthKey))).getTime() / 1000).toString();
    const activities: StravaSummaryActivity[] = [];
    for (let page = 1; ; page += 1) {
      const url = new URL("https://www.strava.com/api/v3/athlete/activities");
      url.searchParams.set("after", after);
      url.searchParams.set("before", before);
      url.searchParams.set("per_page", "100");
      url.searchParams.set("page", page.toString());

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (!response.ok) {
        throw new DomainError(`Strava activities request failed with HTTP ${response.status}.`);
      }

      const pageActivities = (await response.json()) as StravaSummaryActivity[];
      activities.push(...pageActivities);
      if (pageActivities.length < 100) {
        break;
      }
    }

    return activities
      .filter((activity) => STRAVA_RUN_SPORT_TYPES.has(activity.sport_type ?? activity.type ?? ""))
      .filter((activity) => typeof activity.distance === "number")
      .map((activity) => ({
        activityId: activity.id.toString(),
        athleteId,
        distanceKm: Math.round(((activity.distance ?? 0) / 1000) * 100) / 100,
        runDate: (activity.start_date_local ?? activity.start_date ?? "").slice(0, 10),
      }));
  }

  private async findConnectionByAthleteId(athleteId: string): Promise<StravaConnection | undefined> {
    for (const workspace of await this.repository.listWorkspaces()) {
      for (const member of await this.repository.listMembersByWorkspace(workspace.id)) {
        const connection = await this.repository.getStravaConnectionByMemberId(member.id);
        if (connection?.athleteId === athleteId) {
          return connection;
        }
      }
    }
    return undefined;
  }

  private async getAccessToken(connection: StravaConnection): Promise<string> {
    const expiresWithinOneHour = connection.expiresAt <= Math.floor(Date.now() / 1000) + 3600;
    if (!expiresWithinOneHour) {
      return connection.accessToken;
    }

    const token = await this.requestToken({
      grant_type: "refresh_token",
      refresh_token: connection.refreshToken,
    });
    const updated: StravaConnection = {
      ...connection,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_at,
      updatedAt: nowIso(),
    };
    await this.repository.saveStravaConnection(updated);
    return updated.accessToken;
  }

  private async requestToken(body: Record<string, string>): Promise<StravaTokenResponse> {
    const response = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        ...body,
      }),
    });
    if (!response.ok) {
      throw new DomainError(`Strava token request failed with HTTP ${response.status}.`);
    }
    const token = (await response.json()) as StravaTokenResponse;
    if (
      typeof token.access_token !== "string" ||
      typeof token.refresh_token !== "string" ||
      !Number.isFinite(token.expires_at)
    ) {
      throw new DomainError("Strava token response was missing required token fields.");
    }
    return token;
  }
}
