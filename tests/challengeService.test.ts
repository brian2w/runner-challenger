import { createHmac } from "node:crypto";
import { deepEqual, equal, ok, rejects, throws } from "node:assert/strict";
import { describe, it } from "node:test";
import { DiscordCommandHandler } from "../src/adapters/discord/discordCommandHandler.js";
import { DiscordPresenter } from "../src/adapters/discord/discordPresenter.js";
import { decodeStravaOAuthState, encodeStravaOAuthState } from "../src/adapters/strava/oauthState.js";
import { FakeStravaProvider, StravaOAuthClient } from "../src/adapters/strava/stravaProvider.js";
import { createMonthKey, createMonthKeyForDate } from "../src/core/time.js";
import type { StravaActivity, StravaConnection } from "../src/core/types.js";
import { InMemoryChallengeRepository } from "../src/repositories/inMemoryChallengeRepository.js";
import { JsonFileChallengeRepository } from "../src/repositories/jsonFileChallengeRepository.js";
import { ChallengeService } from "../src/services/challengeService.js";

function signStravaOAuthStatePayload(payload: unknown, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");
  return `${encodedPayload}.${signature}`;
}

class FailsPromptPersistenceOnceRepository extends InMemoryChallengeRepository {
  private promptWrites = 0;
  private hasFailed = false;

  override async saveScheduledPrompt(
    prompt: Parameters<InMemoryChallengeRepository["saveScheduledPrompt"]>[0],
  ): Promise<void> {
    this.promptWrites += 1;
    if (!this.hasFailed && this.promptWrites === 4) {
      this.hasFailed = true;
      throw new Error("simulated prompt persistence failure");
    }

    await super.saveScheduledPrompt(prompt);
  }
}

class FailsAfterFinalPromptMutationRepository extends InMemoryChallengeRepository {
  promptWrites = 0;
  private hasFailed = false;

  override async saveScheduledPrompt(
    prompt: Parameters<InMemoryChallengeRepository["saveScheduledPrompt"]>[0],
  ): Promise<void> {
    this.promptWrites += 1;
    await super.saveScheduledPrompt(prompt);
    if (!this.hasFailed && this.promptWrites === 9) {
      this.hasFailed = true;
      throw new Error("simulated post-mutation prompt persistence failure");
    }
  }
}

class FailsFirstCloseChallengeSaveRepository extends InMemoryChallengeRepository {
  private hasFailedClose = false;

  override async saveChallenge(
    challenge: Parameters<InMemoryChallengeRepository["saveChallenge"]>[0],
  ): Promise<void> {
    if (!this.hasFailedClose && challenge.status === "closed") {
      this.hasFailedClose = true;
      throw new Error("simulated challenge close failure");
    }

    await super.saveChallenge(challenge);
  }
}

class FailsFirstTwoCloseChallengeSavesRepository extends InMemoryChallengeRepository {
  private failedCloseCount = 0;

  override async saveChallenge(
    challenge: Parameters<InMemoryChallengeRepository["saveChallenge"]>[0],
  ): Promise<void> {
    if (this.failedCloseCount < 2 && challenge.status === "closed") {
      this.failedCloseCount += 1;
      throw new Error("simulated repeated challenge close failure");
    }

    await super.saveChallenge(challenge);
  }
}

class FailsAfterCloseChallengeMutationRepository extends InMemoryChallengeRepository {
  private hasFailedClose = false;

  override async saveChallenge(
    challenge: Parameters<InMemoryChallengeRepository["saveChallenge"]>[0],
  ): Promise<void> {
    await super.saveChallenge(challenge);
    if (!this.hasFailedClose && challenge.status === "closed") {
      this.hasFailedClose = true;
      throw new Error("simulated post-mutation challenge close failure");
    }
  }
}

async function createFixture() {
  const month = createMonthKey(2026, 4);
  const repository = new InMemoryChallengeRepository();
  const stravaActivities = new Map<string, StravaActivity[]>();
  const stravaProvider = new FakeStravaProvider(stravaActivities);
  const service = new ChallengeService(repository, stravaProvider);

  const workspace = await service.createWorkspace({
    name: "Run Club",
    discordGuildId: "guild-1",
    timezone: "Australia/Sydney",
    channelRefs: {
      rules: "rules",
      announcements: "announcements",
      progressLog: "progress-log",
      leaderboard: "leaderboard",
      chat: "chat",
      combined: "combined",
    },
  });

  const john = await service.registerMember({
    workspaceId: workspace.id,
    discordUserId: "discord-john",
    displayName: "John",
    connectedStravaAthleteId: "athlete-john",
  });
  const sarah = await service.registerMember({
    workspaceId: workspace.id,
    discordUserId: "discord-sarah",
    displayName: "Sarah",
  });
  const mike = await service.registerMember({
    workspaceId: workspace.id,
    discordUserId: "discord-mike",
    displayName: "Mike",
  });

  await service.startMonth({ workspaceId: workspace.id, month });
  await service.assignLeader({ workspaceId: workspace.id, month, memberId: john.id });

  return {
    month,
    repository,
    stravaActivities,
    service,
    workspace,
    john,
    sarah,
    mike,
  };
}

describe("ChallengeService", () => {
  it("sets a monthly goal with carryover applied to the effective target", async () => {
    const fixture = await createFixture();

    await fixture.service.setGoal({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      memberId: fixture.john.id,
      baseGoalKm: 100,
    });
    await fixture.service.submitManualRun({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      memberId: fixture.john.id,
      distanceKm: 80,
      runDate: "2026-04-04",
      evidenceUrl: "https://cdn.example/manual-1.png",
    });

    await fixture.service.closeMonth({ workspaceId: fixture.workspace.id, month: fixture.month });

    const nextMonth = createMonthKey(2026, 5);
    await fixture.service.startMonth({ workspaceId: fixture.workspace.id, month: nextMonth });
    const goal = await fixture.service.setGoal({
      workspaceId: fixture.workspace.id,
      month: nextMonth,
      memberId: fixture.john.id,
      baseGoalKm: 120,
    });

    equal(goal.carryoverKm, 23);
    equal(goal.effectiveGoalKm, 143);
  });

  it("increments totals and leaderboard when a manual run is submitted", async () => {
    const fixture = await createFixture();

    await fixture.service.setGoal({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      memberId: fixture.john.id,
      baseGoalKm: 100,
    });
    await fixture.service.submitManualRun({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      memberId: fixture.john.id,
      distanceKm: 5,
      runDate: "2026-04-02",
      evidenceUrl: "https://cdn.example/john-5k.png",
    });

    const leaderboard = await fixture.service.getLeaderboard({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
    });

    equal(leaderboard[0]?.displayName, "John");
    equal(leaderboard[0]?.completedKm, 5);
    equal(leaderboard[0]?.percentComplete, 5);
  });

  it("excludes bot accounts from leaderboard rows and group totals", async () => {
    const fixture = await createFixture();
    const bot = await fixture.service.registerMember({
      workspaceId: fixture.workspace.id,
      discordUserId: "discord-bot",
      displayName: "Run Club Ref",
      isBot: true,
    });

    await fixture.service.setGoal({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      memberId: fixture.john.id,
      baseGoalKm: 40,
    });
    await fixture.service.setGoal({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      memberId: fixture.sarah.id,
      baseGoalKm: 40,
    });
    await fixture.service.submitManualRun({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      memberId: fixture.john.id,
      distanceKm: 20,
      runDate: "2026-04-02",
      evidenceUrl: "https://cdn.example/john-20k.png",
    });

    const leaderboard = await fixture.service.getLeaderboard({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
    });
    const group = await fixture.service.getGroupProgress({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
    });

    equal(leaderboard.some((row) => row.memberId === bot.id), false);
    equal(leaderboard.some((row) => row.displayName === "Run Club Ref"), false);
    equal(group.completedKm, 20);
    equal(group.effectiveGoalKm, 80);
    equal(group.membersWithGoals, 2);
    equal(group.totalMembers, 3);
  });

  it("rejects bot accounts from participant actions", async () => {
    const fixture = await createFixture();
    const bot = await fixture.service.registerMember({
      workspaceId: fixture.workspace.id,
      discordUserId: "discord-bot",
      displayName: "Run Club Ref",
      isBot: true,
    });

    await rejects(() =>
      fixture.service.setGoal({
        workspaceId: fixture.workspace.id,
        month: fixture.month,
        memberId: bot.id,
        baseGoalKm: 40,
      }),
      /Bot accounts cannot participate/,
    );
    await rejects(() =>
      fixture.service.assignLeader({
        workspaceId: fixture.workspace.id,
        month: fixture.month,
        memberId: bot.id,
      }),
      /Bot accounts cannot participate/,
    );
  });

  it("deduplicates Strava imports by external activity id", async () => {
    const fixture = await createFixture();
    fixture.stravaActivities.set("athlete-john", [
      {
        activityId: "strava-1",
        athleteId: "athlete-john",
        distanceKm: 12.5,
        runDate: "2026-04-03",
      },
      {
        activityId: "strava-2",
        athleteId: "athlete-john",
        distanceKm: 7,
        runDate: "2026-04-05",
      },
    ]);

    const firstImport = await fixture.service.syncStravaRuns({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      memberId: fixture.john.id,
    });
    const secondImport = await fixture.service.syncStravaRuns({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      memberId: fixture.john.id,
    });

    equal(firstImport.length, 2);
    equal(secondImport.length, 0);
  });

  it("applies admin overrides to leaderboard totals", async () => {
    const fixture = await createFixture();
    await fixture.service.setGoal({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      memberId: fixture.john.id,
      baseGoalKm: 100,
    });
    const submission = await fixture.service.submitManualRun({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      memberId: fixture.john.id,
      distanceKm: 10,
      runDate: "2026-04-06",
      evidenceUrl: "https://cdn.example/10k.png",
    });

    await fixture.service.overrideRun({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      submissionId: submission.id,
      action: "replace_distance",
      distanceKm: 8,
      note: "GPS screenshot showed 8.0km, not 10km.",
    });

    const leaderboard = await fixture.service.getLeaderboard({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
    });
    equal(leaderboard[0]?.completedKm, 8);
  });

  it("computes hit and miss results with carryovers at month close", async () => {
    const fixture = await createFixture();

    await fixture.service.setGoal({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      memberId: fixture.john.id,
      baseGoalKm: 100,
    });
    await fixture.service.setGoal({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      memberId: fixture.sarah.id,
      baseGoalKm: 50,
    });
    await fixture.service.submitManualRun({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      memberId: fixture.john.id,
      distanceKm: 100,
      runDate: "2026-04-10",
      evidenceUrl: "https://cdn.example/100k.png",
    });
    await fixture.service.submitManualRun({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      memberId: fixture.sarah.id,
      distanceKm: 35,
      runDate: "2026-04-09",
      evidenceUrl: "https://cdn.example/35k.png",
    });

    const summary = await fixture.service.closeMonth({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
    });

    const johnResult = summary.results.find((result) => result.memberId === fixture.john.id);
    const sarahResult = summary.results.find((result) => result.memberId === fixture.sarah.id);
    equal(johnResult?.hitGoal, true);
    equal(johnResult?.generatedCarryoverKm, 0);
    equal(sarahResult?.hitGoal, false);
    equal(sarahResult?.missedKm, 15);
    equal(sarahResult?.generatedCarryoverKm, 17.25);
  });

  it("handles members without goals and without submissions in the monthly summary", async () => {
    const fixture = await createFixture();
    await fixture.service.setGoal({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      memberId: fixture.john.id,
      baseGoalKm: 100,
    });

    const summary = await fixture.service.closeMonth({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
    });
    const mikeResult = summary.results.find((result) => result.memberId === fixture.mike.id);

    equal(mikeResult?.noGoalSet, true);
    equal(mikeResult?.generatedCarryoverKm, 0);
  });

  it("creates scheduled prompts for the correct month and challenge", async () => {
    const fixture = await createFixture();

    const summary = await fixture.service.getMonthlySummary({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
    });

    equal(summary.prompts.length, 9);
    ok(summary.prompts.every((prompt) => prompt.month === fixture.month));
    ok(summary.prompts.every((prompt) => prompt.challengeId === summary.challenge.id));
    equal(summary.prompts.at(-1)?.kind, "month_close");
  });

  it("repairs missing scheduled prompts when start month is retried after a partial failure", async () => {
    const month = createMonthKey(2026, 4);
    const repository = new FailsPromptPersistenceOnceRepository();
    const service = new ChallengeService(repository);
    const workspace = await service.createWorkspace({
      name: "Run Club",
      discordGuildId: "guild-1",
      timezone: "Australia/Sydney",
      channelRefs: {
        rules: "rules",
        announcements: "announcements",
        progressLog: "progress-log",
        leaderboard: "leaderboard",
        chat: "chat",
        combined: "combined",
      },
    });

    await rejects(
      () => service.startMonth({ workspaceId: workspace.id, month }),
      /simulated prompt persistence failure/,
    );

    const challenge = await service.startMonth({ workspaceId: workspace.id, month });
    const prompts = await repository.listScheduledPromptsByChallenge(challenge.id);

    equal(prompts.length, 9);
    const promptKeys = prompts.map((prompt) => `${prompt.kind}:${prompt.scheduledFor}:${prompt.channelKey}`);
    equal(new Set(promptKeys).size, 9);
  });

  it("re-persists deterministic scheduled prompts after a post-mutation prompt failure", async () => {
    const month = createMonthKey(2026, 4);
    const repository = new FailsAfterFinalPromptMutationRepository();
    const service = new ChallengeService(repository);
    const workspace = await service.createWorkspace({
      name: "Run Club",
      discordGuildId: "guild-1",
      timezone: "Australia/Sydney",
      channelRefs: {
        rules: "rules",
        announcements: "announcements",
        progressLog: "progress-log",
        leaderboard: "leaderboard",
        chat: "chat",
        combined: "combined",
      },
    });

    await rejects(
      () => service.startMonth({ workspaceId: workspace.id, month }),
      /simulated post-mutation prompt persistence failure/,
    );
    await service.startMonth({ workspaceId: workspace.id, month });

    equal(repository.promptWrites > 9, true);
    const challenge = await repository.getChallengeByMonth(workspace.id, month);
    const prompts = await repository.listScheduledPromptsByChallenge(challenge!.id);
    equal(prompts.length, 9);
  });

  it("preserves delivered prompt metadata when re-persisting deterministic scheduled prompts", async () => {
    const fixture = await createFixture();
    const summary = await fixture.service.getMonthlySummary({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
    });
    const deliveredPrompt = {
      ...summary.prompts[0]!,
      deliveredAt: "2026-04-01T12:00:00.000Z",
    };
    await fixture.repository.saveScheduledPrompt(deliveredPrompt);

    await fixture.service.startMonth({ workspaceId: fixture.workspace.id, month: fixture.month });
    const prompts = await fixture.repository.listScheduledPromptsByChallenge(summary.challenge.id);

    equal(
      prompts.find((prompt) => prompt.id === deliveredPrompt.id)?.deliveredAt,
      deliveredPrompt.deliveredAt,
    );
  });

  it("does not duplicate carryovers when close month is retried after a partial failure", async () => {
    const month = createMonthKey(2026, 4);
    const repository = new FailsFirstCloseChallengeSaveRepository();
    const service = new ChallengeService(repository);
    const workspace = await service.createWorkspace({
      name: "Run Club",
      discordGuildId: "guild-1",
      timezone: "Australia/Sydney",
      channelRefs: {
        rules: "rules",
        announcements: "announcements",
        progressLog: "progress-log",
        leaderboard: "leaderboard",
        chat: "chat",
        combined: "combined",
      },
    });
    const member = await service.registerMember({
      workspaceId: workspace.id,
      discordUserId: "discord-john",
      displayName: "John",
    });
    await service.startMonth({ workspaceId: workspace.id, month });
    await service.setGoal({
      workspaceId: workspace.id,
      month,
      memberId: member.id,
      baseGoalKm: 100,
    });
    await service.submitManualRun({
      workspaceId: workspace.id,
      month,
      memberId: member.id,
      distanceKm: 80,
      runDate: "2026-04-04",
      evidenceUrl: "https://cdn.example/manual-1.png",
    });

    await rejects(
      () => service.closeMonth({ workspaceId: workspace.id, month }),
      /simulated challenge close failure/,
    );
    await service.closeMonth({ workspaceId: workspace.id, month });
    const nextMonth = createMonthKey(2026, 5);
    await service.startMonth({ workspaceId: workspace.id, month: nextMonth });
    const goal = await service.setGoal({
      workspaceId: workspace.id,
      month: nextMonth,
      memberId: member.id,
      baseGoalKm: 120,
    });

    equal(goal.carryoverKm, 23);
    const challenge = await repository.getChallengeByMonth(workspace.id, month);
    equal((await repository.listMonthlyResultsByChallenge(challenge!.id)).length, 1);
  });

  it("removes stale carryover distance when a retry closes a month after the goal is recovered", async () => {
    const month = createMonthKey(2026, 4);
    const repository = new FailsFirstCloseChallengeSaveRepository();
    const service = new ChallengeService(repository);
    const workspace = await service.createWorkspace({
      name: "Run Club",
      discordGuildId: "guild-1",
      timezone: "Australia/Sydney",
      channelRefs: {
        rules: "rules",
        announcements: "announcements",
        progressLog: "progress-log",
        leaderboard: "leaderboard",
        chat: "chat",
        combined: "combined",
      },
    });
    const member = await service.registerMember({
      workspaceId: workspace.id,
      discordUserId: "discord-john",
      displayName: "John",
    });
    await service.startMonth({ workspaceId: workspace.id, month });
    await service.setGoal({
      workspaceId: workspace.id,
      month,
      memberId: member.id,
      baseGoalKm: 100,
    });
    await service.submitManualRun({
      workspaceId: workspace.id,
      month,
      memberId: member.id,
      distanceKm: 80,
      runDate: "2026-04-04",
      evidenceUrl: "https://cdn.example/manual-1.png",
    });

    await rejects(
      () => service.closeMonth({ workspaceId: workspace.id, month }),
      /simulated challenge close failure/,
    );
    await service.submitManualRun({
      workspaceId: workspace.id,
      month,
      memberId: member.id,
      distanceKm: 20,
      runDate: "2026-04-05",
      evidenceUrl: "https://cdn.example/manual-2.png",
    });
    await service.closeMonth({ workspaceId: workspace.id, month });
    const nextMonth = createMonthKey(2026, 5);
    await service.startMonth({ workspaceId: workspace.id, month: nextMonth });
    const goal = await service.setGoal({
      workspaceId: workspace.id,
      month: nextMonth,
      memberId: member.id,
      baseGoalKm: 120,
    });

    equal(goal.carryoverKm, 0);
  });

  it("retries month close after the repository mutates the challenge before failing", async () => {
    const month = createMonthKey(2026, 4);
    const repository = new FailsAfterCloseChallengeMutationRepository();
    const service = new ChallengeService(repository);
    const workspace = await service.createWorkspace({
      name: "Run Club",
      discordGuildId: "guild-1",
      timezone: "Australia/Sydney",
      channelRefs: {
        rules: "rules",
        announcements: "announcements",
        progressLog: "progress-log",
        leaderboard: "leaderboard",
        chat: "chat",
        combined: "combined",
      },
    });
    const member = await service.registerMember({
      workspaceId: workspace.id,
      discordUserId: "discord-john",
      displayName: "John",
    });
    await service.startMonth({ workspaceId: workspace.id, month });
    await service.setGoal({
      workspaceId: workspace.id,
      month,
      memberId: member.id,
      baseGoalKm: 100,
    });

    await rejects(
      () => service.closeMonth({ workspaceId: workspace.id, month }),
      /simulated post-mutation challenge close failure/,
    );
    const summary = await service.closeMonth({ workspaceId: workspace.id, month });

    equal(summary.results.length, 1);
    equal(summary.results[0]?.generatedCarryoverKm, 115);
  });

  it("does not add newly registered members to an already-closed month during retry", async () => {
    const month = createMonthKey(2026, 4);
    const repository = new FailsAfterCloseChallengeMutationRepository();
    const service = new ChallengeService(repository);
    const workspace = await service.createWorkspace({
      name: "Run Club",
      discordGuildId: "guild-1",
      timezone: "Australia/Sydney",
      channelRefs: {
        rules: "rules",
        announcements: "announcements",
        progressLog: "progress-log",
        leaderboard: "leaderboard",
        chat: "chat",
        combined: "combined",
      },
    });
    const originalMember = await service.registerMember({
      workspaceId: workspace.id,
      discordUserId: "discord-john",
      displayName: "John",
    });
    await service.startMonth({ workspaceId: workspace.id, month });
    await service.setGoal({
      workspaceId: workspace.id,
      month,
      memberId: originalMember.id,
      baseGoalKm: 100,
    });

    await rejects(
      () => service.closeMonth({ workspaceId: workspace.id, month }),
      /simulated post-mutation challenge close failure/,
    );
    const lateMember = await service.registerMember({
      workspaceId: workspace.id,
      discordUserId: "discord-late",
      displayName: "Late Joiner",
    });
    await repository.saveMember({
      ...lateMember,
      createdAt: "9999-12-31T23:59:59.999Z",
    });
    const summary = await service.closeMonth({ workspaceId: workspace.id, month });

    equal(summary.results.length, 1);
    equal(summary.results.some((result) => result.memberId === originalMember.id), true);
    equal(summary.results.some((result) => result.memberId === lateMember.id), false);
    const challenge = await repository.getChallengeByMonth(workspace.id, month);
    equal((await repository.listMonthlyResultsByChallenge(challenge!.id)).length, 1);
  });

  it("recovers missing original members when retrying an already-closed partial month", async () => {
    const month = createMonthKey(2026, 4);
    const repository = new InMemoryChallengeRepository();
    const service = new ChallengeService(repository);
    const workspace = await service.createWorkspace({
      name: "Run Club",
      discordGuildId: "guild-1",
      timezone: "Australia/Sydney",
      channelRefs: {
        rules: "rules",
        announcements: "announcements",
        progressLog: "progress-log",
        leaderboard: "leaderboard",
        chat: "chat",
        combined: "combined",
      },
    });
    const john = await service.registerMember({
      workspaceId: workspace.id,
      discordUserId: "discord-john",
      displayName: "John",
    });
    const sarah = await service.registerMember({
      workspaceId: workspace.id,
      discordUserId: "discord-sarah",
      displayName: "Sarah",
    });
    await repository.saveMember({
      ...john,
      createdAt: "2026-04-01T00:00:00.000Z",
    });
    await repository.saveMember({
      ...sarah,
      createdAt: "2026-04-01T00:00:00.000Z",
    });
    const challenge = await service.startMonth({ workspaceId: workspace.id, month });
    await service.setGoal({
      workspaceId: workspace.id,
      month,
      memberId: john.id,
      baseGoalKm: 100,
    });
    await service.setGoal({
      workspaceId: workspace.id,
      month,
      memberId: sarah.id,
      baseGoalKm: 50,
    });
    await repository.saveMonthlyResult({
      id: "partial-result-john",
      workspaceId: workspace.id,
      challengeId: challenge.id,
      memberId: john.id,
      completedKm: 0,
      baseGoalKm: 100,
      carryoverKm: 0,
      effectiveGoalKm: 100,
      hitGoal: false,
      missedKm: 100,
      generatedCarryoverKm: 115,
      noGoalSet: false,
      closedAt: "2026-04-30T23:59:59.999Z",
    });
    await repository.saveChallenge({
      ...challenge,
      status: "closed",
      closedAt: "2026-04-30T23:59:59.999Z",
    });
    const lateMember = await service.registerMember({
      workspaceId: workspace.id,
      discordUserId: "discord-late",
      displayName: "Late Joiner",
    });
    await repository.saveMember({
      ...lateMember,
      createdAt: "9999-12-31T23:59:59.999Z",
    });

    const summary = await service.closeMonth({ workspaceId: workspace.id, month });

    equal(summary.results.length, 2);
    equal(summary.results.some((result) => result.memberId === john.id), true);
    equal(summary.results.some((result) => result.memberId === sarah.id), true);
    equal(summary.results.some((result) => result.memberId === lateMember.id), false);
  });

  it("does not add late members when retrying an open month with existing close results", async () => {
    const month = createMonthKey(2026, 4);
    const repository = new FailsFirstCloseChallengeSaveRepository();
    const service = new ChallengeService(repository);
    const workspace = await service.createWorkspace({
      name: "Run Club",
      discordGuildId: "guild-1",
      timezone: "Australia/Sydney",
      channelRefs: {
        rules: "rules",
        announcements: "announcements",
        progressLog: "progress-log",
        leaderboard: "leaderboard",
        chat: "chat",
        combined: "combined",
      },
    });
    const originalMember = await service.registerMember({
      workspaceId: workspace.id,
      discordUserId: "discord-john",
      displayName: "John",
    });
    await service.startMonth({ workspaceId: workspace.id, month });
    await service.setGoal({
      workspaceId: workspace.id,
      month,
      memberId: originalMember.id,
      baseGoalKm: 100,
    });

    await rejects(() => service.closeMonth({ workspaceId: workspace.id, month }), /simulated challenge close failure/);
    const challenge = await repository.getChallengeByMonth(workspace.id, month);
    const firstResults = await repository.listMonthlyResultsByChallenge(challenge!.id);
    const lateMember = await service.registerMember({
      workspaceId: workspace.id,
      discordUserId: "discord-late",
      displayName: "Late Joiner",
    });
    await repository.saveMember({
      ...lateMember,
      createdAt: "9999-12-31T23:59:59.999Z",
    });

    const summary = await service.closeMonth({ workspaceId: workspace.id, month });

    equal(firstResults.length, 1);
    equal(summary.results.length, 1);
    equal(summary.results.some((result) => result.memberId === originalMember.id), true);
    equal(summary.results.some((result) => result.memberId === lateMember.id), false);
    equal((await repository.listMonthlyResultsByChallenge(challenge!.id)).length, 1);
  });

  it("keeps the original close cutoff stable across repeated open-month close retries", async () => {
    const month = createMonthKey(2026, 4);
    const repository = new FailsFirstTwoCloseChallengeSavesRepository();
    const service = new ChallengeService(repository);
    const workspace = await service.createWorkspace({
      name: "Run Club",
      discordGuildId: "guild-1",
      timezone: "Australia/Sydney",
      channelRefs: {
        rules: "rules",
        announcements: "announcements",
        progressLog: "progress-log",
        leaderboard: "leaderboard",
        chat: "chat",
        combined: "combined",
      },
    });
    const originalMember = await service.registerMember({
      workspaceId: workspace.id,
      discordUserId: "discord-john",
      displayName: "John",
    });
    await service.startMonth({ workspaceId: workspace.id, month });
    await service.setGoal({
      workspaceId: workspace.id,
      month,
      memberId: originalMember.id,
      baseGoalKm: 100,
    });

    await rejects(
      () => service.closeMonth({ workspaceId: workspace.id, month }),
      /simulated repeated challenge close failure/,
    );
    const challenge = await repository.getChallengeByMonth(workspace.id, month);
    const [firstResult] = await repository.listMonthlyResultsByChallenge(challenge!.id);
    await repository.saveMonthlyResult({
      ...firstResult!,
      closedAt: "2026-04-01T00:00:00.000Z",
    });
    const lateMember = await service.registerMember({
      workspaceId: workspace.id,
      discordUserId: "discord-late",
      displayName: "Late Joiner",
    });
    await repository.saveMember({
      ...lateMember,
      createdAt: "2026-04-02T00:00:00.000Z",
    });
    await rejects(
      () => service.closeMonth({ workspaceId: workspace.id, month }),
      /simulated repeated challenge close failure/,
    );

    const summary = await service.closeMonth({ workspaceId: workspace.id, month });

    equal(summary.results.length, 1);
    equal(summary.results.some((result) => result.memberId === originalMember.id), true);
    equal(summary.results.some((result) => result.memberId === lateMember.id), false);
    equal(summary.results[0]?.closedAt, "2026-04-01T00:00:00.000Z");
  });

  it("uses one recalculated carryover when legacy duplicate carryover records exist", async () => {
    const month = createMonthKey(2026, 4);
    const repository = new InMemoryChallengeRepository();
    const service = new ChallengeService(repository);
    const workspace = await service.createWorkspace({
      name: "Run Club",
      discordGuildId: "guild-1",
      timezone: "Australia/Sydney",
      channelRefs: {
        rules: "rules",
        announcements: "announcements",
        progressLog: "progress-log",
        leaderboard: "leaderboard",
        chat: "chat",
        combined: "combined",
      },
    });
    const member = await service.registerMember({
      workspaceId: workspace.id,
      discordUserId: "discord-john",
      displayName: "John",
    });
    const challenge = await service.startMonth({ workspaceId: workspace.id, month });
    await service.setGoal({
      workspaceId: workspace.id,
      month,
      memberId: member.id,
      baseGoalKm: 100,
    });
    await service.submitManualRun({
      workspaceId: workspace.id,
      month,
      memberId: member.id,
      distanceKm: 80,
      runDate: "2026-04-04",
      evidenceUrl: "https://cdn.example/manual-1.png",
    });
    const nextMonth = createMonthKey(2026, 5);
    await repository.saveCarryoverPenalty({
      id: "legacy-carryover-1",
      workspaceId: workspace.id,
      memberId: member.id,
      sourceChallengeId: challenge.id,
      targetMonth: nextMonth,
      amountKm: 23,
      createdAt: "2026-05-01T00:00:00.000Z",
    });
    await repository.saveCarryoverPenalty({
      id: "legacy-carryover-2",
      workspaceId: workspace.id,
      memberId: member.id,
      sourceChallengeId: challenge.id,
      targetMonth: nextMonth,
      amountKm: 23,
      createdAt: "2026-05-01T00:00:01.000Z",
    });

    await service.closeMonth({ workspaceId: workspace.id, month });
    await service.startMonth({ workspaceId: workspace.id, month: nextMonth });
    const goal = await service.setGoal({
      workspaceId: workspace.id,
      month: nextMonth,
      memberId: member.id,
      baseGoalKm: 120,
    });

    equal(goal.carryoverKm, 23);
  });

  it("prefers deterministic carryover records when legacy duplicate amounts disagree", async () => {
    const month = createMonthKey(2026, 5);
    const repository = new InMemoryChallengeRepository();
    const service = new ChallengeService(repository);
    const workspace = await service.createWorkspace({
      name: "Run Club",
      discordGuildId: "guild-1",
      timezone: "Australia/Sydney",
      channelRefs: {
        rules: "rules",
        announcements: "announcements",
        progressLog: "progress-log",
        leaderboard: "leaderboard",
        chat: "chat",
        combined: "combined",
      },
    });
    const member = await service.registerMember({
      workspaceId: workspace.id,
      discordUserId: "discord-john",
      displayName: "John",
    });
    await service.startMonth({ workspaceId: workspace.id, month });
    await repository.saveCarryoverPenalty({
      id: "legacy-carryover-older",
      workspaceId: workspace.id,
      memberId: member.id,
      sourceChallengeId: "source-challenge-1",
      targetMonth: month,
      amountKm: 46,
      createdAt: "2026-05-01T00:00:00.000Z",
    });
    await repository.saveCarryoverPenalty({
      id: `carryover-penalty:source-challenge-1:${member.id}`,
      workspaceId: workspace.id,
      memberId: member.id,
      sourceChallengeId: "source-challenge-1",
      targetMonth: month,
      amountKm: 23,
      createdAt: "2026-05-01T00:00:01.000Z",
    });
    await repository.saveCarryoverPenalty({
      id: "legacy-carryover-newer",
      workspaceId: workspace.id,
      memberId: member.id,
      sourceChallengeId: "source-challenge-1",
      targetMonth: month,
      amountKm: 92,
      createdAt: "2026-05-01T00:00:02.000Z",
    });

    const goal = await service.setGoal({
      workspaceId: workspace.id,
      month,
      memberId: member.id,
      baseGoalKm: 120,
    });

    equal(goal.carryoverKm, 23);
  });

  it("keeps the selected legacy carryover authoritative when a retry recalculates it to zero", async () => {
    const month = createMonthKey(2026, 4);
    const nextMonth = createMonthKey(2026, 5);
    const repository = new InMemoryChallengeRepository();
    const service = new ChallengeService(repository);
    const workspace = await service.createWorkspace({
      name: "Run Club",
      discordGuildId: "guild-1",
      timezone: "Australia/Sydney",
      channelRefs: {
        rules: "rules",
        announcements: "announcements",
        progressLog: "progress-log",
        leaderboard: "leaderboard",
        chat: "chat",
        combined: "combined",
      },
    });
    const member = await service.registerMember({
      workspaceId: workspace.id,
      discordUserId: "discord-john",
      displayName: "John",
    });
    const challenge = await service.startMonth({ workspaceId: workspace.id, month });
    await service.setGoal({
      workspaceId: workspace.id,
      month,
      memberId: member.id,
      baseGoalKm: 100,
    });
    await service.submitManualRun({
      workspaceId: workspace.id,
      month,
      memberId: member.id,
      distanceKm: 100,
      runDate: "2026-04-04",
      evidenceUrl: "https://cdn.example/manual-1.png",
    });
    await repository.saveChallenge({
      ...challenge,
      status: "closed",
      closedAt: "2026-04-30T23:59:59.999Z",
    });
    await repository.saveCarryoverPenalty({
      id: "legacy-carryover-stale",
      workspaceId: workspace.id,
      memberId: member.id,
      sourceChallengeId: challenge.id,
      targetMonth: nextMonth,
      amountKm: 23,
      createdAt: "2026-05-01T00:00:00.000Z",
    });
    await repository.saveCarryoverPenalty({
      id: "legacy-carryover-selected",
      workspaceId: workspace.id,
      memberId: member.id,
      sourceChallengeId: challenge.id,
      targetMonth: nextMonth,
      amountKm: 23,
      createdAt: "2026-05-02T00:00:00.000Z",
    });

    await service.closeMonth({ workspaceId: workspace.id, month });
    await service.startMonth({ workspaceId: workspace.id, month: nextMonth });
    const goal = await service.setGoal({
      workspaceId: workspace.id,
      month: nextMonth,
      memberId: member.id,
      baseGoalKm: 120,
    });

    equal(goal.carryoverKm, 0);
  });

  it("isolates groups so one workspace does not affect another", async () => {
    const fixture = await createFixture();
    const secondWorkspace = await fixture.service.createWorkspace({
      name: "Evening Milers",
      discordGuildId: "guild-2",
      timezone: "Australia/Sydney",
      channelRefs: {
        rules: "rules-2",
        announcements: "announcements-2",
        progressLog: "progress-log-2",
        leaderboard: "leaderboard-2",
        chat: "chat-2",
        combined: "combined-2",
      },
    });
    const otherMember = await fixture.service.registerMember({
      workspaceId: secondWorkspace.id,
      discordUserId: "discord-other",
      displayName: "Other",
    });
    await fixture.service.startMonth({ workspaceId: secondWorkspace.id, month: fixture.month });
    await fixture.service.setGoal({
      workspaceId: secondWorkspace.id,
      month: fixture.month,
      memberId: otherMember.id,
      baseGoalKm: 30,
    });
    await fixture.service.submitManualRun({
      workspaceId: secondWorkspace.id,
      month: fixture.month,
      memberId: otherMember.id,
      distanceKm: 10,
      runDate: "2026-04-08",
      evidenceUrl: "https://cdn.example/other.png",
    });

    const firstLeaderboard = await fixture.service.getLeaderboard({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
    });
    const secondLeaderboard = await fixture.service.getLeaderboard({
      workspaceId: secondWorkspace.id,
      month: fixture.month,
    });

    equal(firstLeaderboard.some((row) => row.displayName === "Other"), false);
    equal(secondLeaderboard.some((row) => row.displayName === "John"), false);
  });

  it("renders Discord summaries with the expected high-signal content", async () => {
    const fixture = await createFixture();
    const presenter = new DiscordPresenter();

    await fixture.service.setGoal({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      memberId: fixture.john.id,
      baseGoalKm: 100,
    });
    await fixture.service.submitManualRun({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      memberId: fixture.john.id,
      distanceKm: 40,
      runDate: "2026-04-07",
      evidenceUrl: "https://cdn.example/john-40.png",
    });

    const monthlySummary = await fixture.service.getMonthlySummary({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
    });
    const leaderboardMessage = presenter.renderLeaderboard(fixture.month, monthlySummary.leaderboard);
    const memberStatuses = await fixture.service.getMemberStatuses(fixture.workspace.id, monthlySummary.challenge.id);
    const statusMessage = presenter.renderMemberStatus(memberStatuses.find((status) => status.memberId === fixture.john.id)!);

    ok(leaderboardMessage.includes("John: 40/100km"));
    ok(statusMessage.includes("40/100km"));
    deepEqual(
      monthlySummary.leaderboard.map((row) => row.displayName),
      ["John", "Sarah", "Mike"],
    );
  });

  it("supports the slash-command flow through the Discord handler", async () => {
    const fixture = await createFixture();
    const handler = new DiscordCommandHandler(fixture.service, fixture.repository);

    const goalReply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.john.id,
      commandName: "goal-set",
      options: {
        distance_km: 90,
      },
    });
    const runReply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.john.id,
      commandName: "run-submit",
      options: {
        distance_km: 12,
        run_date: "2026-04-12",
        screenshot: "https://cdn.example/12k.png",
      },
    });
    const boardReply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.john.id,
      commandName: "leaderboard",
    });

    ok(goalReply.includes("90km"));
    ok(runReply.includes("12km logged"));
    ok(boardReply.includes("Group:"));
    ok(boardReply.includes("12/90km"));
    ok(boardReply.includes("John: 12/90km"));
  });

  it("lets the assigned leader record punishments and members view them", async () => {
    const fixture = await createFixture();
    const handler = new DiscordCommandHandler(fixture.service, fixture.repository);

    const nonLeaderReply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.sarah.id,
      commandName: "leader-record-punishment",
      options: {
        member_id: fixture.mike.id,
        note: "100 burpees",
      },
    });
    const leaderReply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.john.id,
      commandName: "leader-record-punishment",
      options: {
        member_id: fixture.mike.id,
        note: "100 burpees",
      },
    });
    const selfPunishmentsReply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.mike.id,
      commandName: "punishments",
    });

    ok(nonLeaderReply.includes("assigned leader or an admin"));
    ok(leaderReply.includes("Punishment recorded for Mike"));
    ok(selfPunishmentsReply.includes("Mike: 100 burpees"));
    ok(selfPunishmentsReply.includes("assigned by John"));
  });

  it("lets only the assigned leader remove punishments", async () => {
    const fixture = await createFixture();
    const handler = new DiscordCommandHandler(fixture.service, fixture.repository);
    const punishment = await fixture.service.recordPunishment({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      memberId: fixture.mike.id,
      assignedByMemberId: fixture.john.id,
      note: "100 burpees",
    });

    const nonLeaderReply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.sarah.id,
      commandName: "leader-remove-punishment",
      options: {
        punishment_id: punishment.id,
      },
    });
    const adminNotLeaderReply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.sarah.id,
      isAdmin: true,
      commandName: "leader-remove-punishment",
      options: {
        punishment_id: punishment.id,
      },
    });
    const leaderReply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.john.id,
      commandName: "leader-remove-punishment",
      options: {
        punishment_id: punishment.id,
      },
    });
    const punishmentsReply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.mike.id,
      commandName: "punishments",
    });

    equal(nonLeaderReply, "Error: This command requires the assigned leader.");
    equal(adminNotLeaderReply, "Error: This command requires the assigned leader.");
    ok(leaderReply.includes("Punishment removed for Mike"));
    ok(punishmentsReply.includes("No punishments recorded."));
  });

  it("shows leader-help text that distinguishes admin and leader permissions", async () => {
    const fixture = await createFixture();
    const handler = new DiscordCommandHandler(fixture.service, fixture.repository);

    const leaderReply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.john.id,
      commandName: "leader-help",
    });
    const adminNotLeaderReply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.sarah.id,
      isAdmin: true,
      commandName: "leader-help",
    });

    ok(leaderReply.includes("You are the assigned leader"));
    ok(adminNotLeaderReply.includes("only the assigned leader can remove"));
  });

  it("prompts the leader to assign punishments when a month closes with misses", async () => {
    const fixture = await createFixture();
    const handler = new DiscordCommandHandler(fixture.service, fixture.repository);

    await fixture.service.setGoal({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      memberId: fixture.sarah.id,
      baseGoalKm: 50,
    });
    await fixture.service.submitManualRun({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      memberId: fixture.sarah.id,
      distanceKm: 10,
      runDate: "2026-04-12",
      evidenceUrl: "https://cdn.example/sarah-10k.png",
    });

    const closeReply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.john.id,
      isAdmin: true,
      commandName: "admin-close-month",
      options: {
        month: fixture.month,
      },
    });

    ok(closeReply.includes("Sarah: missed by 40km"));
    ok(closeReply.includes("/leader-record-punishment member note"));
  });

  it("tells members to connect Strava before syncing", async () => {
    const fixture = await createFixture();
    const handler = new DiscordCommandHandler(fixture.service, fixture.repository);

    const reply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.sarah.id,
      commandName: "strava-sync",
    });

    equal(reply, "Error: Connect Strava first with /strava-connect, then run /strava-sync.");
  });

  it("keeps member registration idempotent for the same Discord user", async () => {
    const fixture = await createFixture();

    const updated = await fixture.service.registerMember({
      workspaceId: fixture.workspace.id,
      discordUserId: fixture.john.discordUserId,
      displayName: "Johnny",
    });
    const members = await fixture.repository.listMembersByWorkspace(fixture.workspace.id);

    equal(updated.id, fixture.john.id);
    equal(members.filter((member) => member.discordUserId === fixture.john.discordUserId).length, 1);
    equal(updated.displayName, "Johnny");
  });

  it("rejects invalid command month, non-finite goal distance, and out-of-month run dates", async () => {
    const fixture = await createFixture();
    const handler = new DiscordCommandHandler(fixture.service, fixture.repository);

    const invalidMonthReply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.john.id,
      isAdmin: true,
      commandName: "admin-start-month",
      options: {
        month: "2026-99",
      },
    });
    const invalidGoalReply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.john.id,
      commandName: "goal-set",
      options: {
        distance_km: Number.POSITIVE_INFINITY,
      },
    });
    const invalidRunReply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.john.id,
      commandName: "run-submit",
      options: {
        distance_km: 5,
        run_date: "2026-05-01",
        screenshot: "https://cdn.example/wrong-month.png",
      },
    });

    ok(invalidMonthReply.includes("Invalid month"));
    ok(invalidGoalReply.startsWith("Error:"));
    ok(invalidRunReply.includes("inside the challenge month"));
  });

  it("uses the latest leader assignment when the leader changes", async () => {
    const fixture = await createFixture();
    await fixture.service.assignLeader({ workspaceId: fixture.workspace.id, month: fixture.month, memberId: fixture.sarah.id });

    const summary = await fixture.service.closeMonth({ workspaceId: fixture.workspace.id, month: fixture.month });

    equal(summary.leaderId, fixture.sarah.id);
  });

  it("computes the active month in the workspace timezone", () => {
    const instant = new Date("2026-04-30T15:30:00.000Z");

    equal(createMonthKeyForDate(instant, "Australia/Sydney"), "2026-05");
    equal(createMonthKeyForDate(instant, "America/Los_Angeles"), "2026-04");
  });

  it("rejects month keys outside canonical YYYY-MM bounds", () => {
    throws(() => createMonthKey(999, 1), /YYYY-MM/);
    throws(() => createMonthKey(10000, 1), /YYYY-MM/);
  });

  it("persists challenge state across JSON repository instances", async () => {
    const filePath = `.tmp/test-${Date.now()}-${Math.random().toString(16).slice(2)}.json`;
    const firstRepository = new JsonFileChallengeRepository(filePath);
    await firstRepository.init();
    const firstService = new ChallengeService(firstRepository);
    const month = createMonthKey(2026, 4);
    const workspace = await firstService.createWorkspace({
      name: "Persisted Club",
      discordGuildId: "guild-persisted",
      timezone: "Australia/Sydney",
      channelRefs: {
        rules: "rules",
        announcements: "announcements",
        progressLog: "progress-log",
        leaderboard: "leaderboard",
        chat: "chat",
        combined: "combined",
      },
    });
    const member = await firstService.registerMember({
      workspaceId: workspace.id,
      discordUserId: "discord-persisted",
      displayName: "Persisted Runner",
    });
    await firstService.startMonth({ workspaceId: workspace.id, month });
    await firstService.setGoal({ workspaceId: workspace.id, month, memberId: member.id, baseGoalKm: 42 });

    const secondRepository = new JsonFileChallengeRepository(filePath);
    await secondRepository.init();
    const secondService = new ChallengeService(secondRepository);
    const leaderboard = await secondService.getLeaderboard({ workspaceId: workspace.id, month });

    equal(leaderboard[0]?.displayName, "Persisted Runner");
    equal(leaderboard[0]?.effectiveGoalKm, 42);
  });

  it("signs Strava OAuth state so callback member ids cannot be silently changed", () => {
    const encoded = encodeStravaOAuthState({ workspaceId: "workspace-1", memberId: "member-1" }, "secret");
    deepEqual(decodeStravaOAuthState(encoded, "secret"), { workspaceId: "workspace-1", memberId: "member-1" });

    const [payload] = encoded.split(".");
    const tamperedPayload = Buffer.from(JSON.stringify({ workspaceId: "workspace-1", memberId: "member-2" })).toString(
      "base64url",
    );
    const tampered = `${tamperedPayload}.${encoded.split(".")[1]}`;

    ok(payload !== tamperedPayload);
    throws(() => decodeStravaOAuthState(tampered, "secret"));
    throws(() => decodeStravaOAuthState(`${payload}.short`, "secret"));
    throws(() => decodeStravaOAuthState(`${encoded}.extra`, "secret"));
    throws(
      () => decodeStravaOAuthState(`${payload}.${"é".repeat(encoded.split(".")[1].length)}`, "secret"),
      /Invalid Strava OAuth state/,
    );
    throws(
      () => decodeStravaOAuthState(signStravaOAuthStatePayload({ workspaceId: ["workspace-1"], memberId: "member-1" }, "secret"), "secret"),
      /Invalid Strava OAuth state payload/,
    );
    throws(
      () => decodeStravaOAuthState(signStravaOAuthStatePayload({ workspaceId: "workspace-1", memberId: 123 }, "secret"), "secret"),
      /Invalid Strava OAuth state payload/,
    );
  });

  it("paginates Strava activity imports and only returns run-like activities", async () => {
    const fixture = await createFixture();
    const connection: StravaConnection = {
      id: "connection-1",
      workspaceId: fixture.workspace.id,
      memberId: fixture.john.id,
      athleteId: "athlete-john",
      scope: "activity:read",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: Math.floor(Date.now() / 1000) + 7200,
      updatedAt: "2026-04-01T00:00:00.000Z",
    };
    await fixture.repository.saveStravaConnection(connection);
    const originalFetch = globalThis.fetch;
    const requestedPages: string[] = [];
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      sport_type: "Run",
      distance: 1000,
      start_date_local: "2026-04-02T08:00:00Z",
    }));
    const secondPage = [
      {
        id: 101,
        sport_type: "TrailRun",
        distance: 2500,
        start_date_local: "2026-04-03T08:00:00Z",
      },
      {
        id: 102,
        sport_type: "Ride",
        distance: 5000,
        start_date_local: "2026-04-04T08:00:00Z",
      },
    ];
    globalThis.fetch = async (input: string | URL | Request) => {
      const url = new URL(input.toString());
      const page = url.searchParams.get("page") ?? "1";
      requestedPages.push(page);
      return new Response(JSON.stringify(page === "1" ? firstPage : secondPage), { status: 200 });
    };

    try {
      const client = new StravaOAuthClient(fixture.repository, {
        clientId: "client-id",
        clientSecret: "client-secret",
        redirectUri: "http://localhost:3000/strava/callback",
      });
      const activities = await client.listActivities("athlete-john", fixture.month);

      deepEqual(requestedPages, ["1", "2"]);
      equal(activities.length, 101);
      equal(activities.at(-1)?.distanceKm, 2.5);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects Strava OAuth connections without activity read scope or complete token fields", async () => {
    const fixture = await createFixture();
    const client = new StravaOAuthClient(fixture.repository, {
      clientId: "client-id",
      clientSecret: "client-secret",
      redirectUri: "http://localhost:3000/strava/callback",
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_at: Math.floor(Date.now() / 1000) + 7200,
          athlete: { id: 123 },
          scope: "read",
        }),
        { status: 200 },
      );

    try {
      await rejects(() => client.exchangeCode({ member: fixture.john, code: "code", scope: "read" }));

      globalThis.fetch = async () => new Response(JSON.stringify({ access_token: "access-token" }), { status: 200 });
      await rejects(() => client.exchangeCode({ member: fixture.john, code: "code", scope: "activity:read" }));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
