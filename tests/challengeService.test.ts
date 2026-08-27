import { deepEqual, equal, ok, rejects, throws } from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { DiscordCommandHandler } from "../src/adapters/discord/discordCommandHandler.js";
import { DiscordPresenter } from "../src/adapters/discord/discordPresenter.js";
import { memberIdentityId } from "../src/core/identityIds.js";
import { createMonthKey, createMonthKeyForDate } from "../src/core/time.js";
import { InMemoryChallengeRepository } from "../src/repositories/inMemoryChallengeRepository.js";
import { JsonFileChallengeRepository } from "../src/repositories/jsonFileChallengeRepository.js";
import { ChallengeService } from "../src/services/challengeService.js";

class FailsNotificationPersistenceOnceRepository extends InMemoryChallengeRepository {
  private promptWrites = 0;
  private hasFailed = false;

  override async saveNotificationIntent(
    intent: Parameters<InMemoryChallengeRepository["saveNotificationIntent"]>[0],
  ): Promise<void> {
    this.promptWrites += 1;
    if (!this.hasFailed && this.promptWrites === 4) {
      this.hasFailed = true;
      throw new Error("simulated prompt persistence failure");
    }

    await super.saveNotificationIntent(intent);
  }
}

class FailsAfterFinalNotificationMutationRepository extends InMemoryChallengeRepository {
  promptWrites = 0;
  private hasFailed = false;

  override async saveNotificationIntent(
    intent: Parameters<InMemoryChallengeRepository["saveNotificationIntent"]>[0],
  ): Promise<void> {
    this.promptWrites += 1;
    await super.saveNotificationIntent(intent);
    if (!this.hasFailed && this.promptWrites === 9) {
      this.hasFailed = true;
      throw new Error("simulated post-mutation prompt persistence failure");
    }
  }
}

class FailsFirstMemberIdentitySaveRepository extends InMemoryChallengeRepository {
  private hasFailed = false;

  override async saveMemberIdentity(
    identity: Parameters<InMemoryChallengeRepository["saveMemberIdentity"]>[0],
  ): Promise<void> {
    if (!this.hasFailed) {
      this.hasFailed = true;
      throw new Error("simulated member identity persistence failure");
    }
    await super.saveMemberIdentity(identity);
  }
}

class FailsFirstWorkspaceIntegrationSaveRepository extends InMemoryChallengeRepository {
  private hasFailed = false;

  override async saveWorkspaceIntegration(
    integration: Parameters<InMemoryChallengeRepository["saveWorkspaceIntegration"]>[0],
  ): Promise<void> {
    if (!this.hasFailed) {
      this.hasFailed = true;
      throw new Error("simulated workspace integration persistence failure");
    }
    await super.saveWorkspaceIntegration(integration);
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
    platform: "discord",
    externalUserId: "discord-john",
    displayName: "John",
  });
  const sarah = await service.registerMember({
    workspaceId: workspace.id,
    platform: "discord",
    externalUserId: "discord-sarah",
    displayName: "Sarah",
  });
  const mike = await service.registerMember({
    workspaceId: workspace.id,
    platform: "discord",
    externalUserId: "discord-mike",
    displayName: "Mike",
  });

  await service.startMonth({ workspaceId: workspace.id, month });
  await service.assignLeader({ workspaceId: workspace.id, month, memberId: john.id });

  return {
    month,
    repository,
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

  it("stores portable proof metadata when a proof-backed run is submitted", async () => {
    const fixture = await createFixture();

    const submission = await fixture.service.submitRunProof({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      memberId: fixture.john.id,
      distanceKm: 6.4,
      runDate: "2026-04-03",
      evidenceUrl: "https://cdn.example/garmin-proof.png",
      evidenceLabel: "Garmin screenshot",
      userNote: "Treadmill cooldown excluded.",
    });

    equal(submission.sourceType, "proof_attachment");
    equal(submission.evidenceUrl, "https://cdn.example/garmin-proof.png");
    equal(submission.evidenceLabel, "Garmin screenshot");
    equal(submission.userNote, "Treadmill cooldown excluded.");
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

    equal(summary.notificationIntents.length, 9);
    ok(summary.notificationIntents.every((intent) => intent.month === fixture.month));
    ok(summary.notificationIntents.every((intent) => intent.challengeId === summary.challenge.id));
    equal(summary.notificationIntents.at(-1)?.kind, "month_close");
  });

  it("repairs missing scheduled prompts when start month is retried after a partial failure", async () => {
    const month = createMonthKey(2026, 4);
    const repository = new FailsNotificationPersistenceOnceRepository();
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
    const promptKeys = prompts.map((prompt) => `${prompt.kind}:${prompt.scheduledFor}:${prompt.audience}`);
    equal(new Set(promptKeys).size, 9);
  });

  it("re-persists deterministic scheduled prompts after a post-mutation prompt failure", async () => {
    const month = createMonthKey(2026, 4);
    const repository = new FailsAfterFinalNotificationMutationRepository();
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
      ...summary.notificationIntents[0]!,
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
    const completedGoalMessage = presenter.renderLeaderboard(fixture.month, [{ ...monthlySummary.leaderboard[0]!, percentComplete: 100 }]);
    const overflowGoalMessage = presenter.renderLeaderboard(fixture.month, [{ ...monthlySummary.leaderboard[0]!, percentComplete: 120 }]);
    const doubleOverflowMessage = presenter.renderLeaderboard(fixture.month, [{ ...monthlySummary.leaderboard[0]!, percentComplete: 220 }]);
    const tripleOverflowMessage = presenter.renderLeaderboard(fixture.month, [{ ...monthlySummary.leaderboard[0]!, percentComplete: 320 }]);

    ok(leaderboardMessage.includes("**#1 · John 👑**\n40/100km"));
    ok(leaderboardMessage.includes("40/100km · 40%\n[💨💨💨👟▫️▫️▫️▫️▫️▫️]"));
    ok(statusMessage.includes("40/100km"));
    ok(statusMessage.includes("[💨💨💨👟▫️▫️▫️▫️▫️▫️]"));
    ok(completedGoalMessage.includes("[✅✅✅✅✅✅✅✅✅✅]"));
    ok(overflowGoalMessage.includes("[😈😈✅✅✅✅✅✅✅✅]"));
    ok(doubleOverflowMessage.includes("[🐦‍🔥🐦‍🔥😈😈😈😈😈😈😈😈]"));
    ok(tripleOverflowMessage.includes("[🐐🐐🐦‍🔥🐦‍🔥🐦‍🔥🐦‍🔥🐦‍🔥🐦‍🔥🐦‍🔥🐦‍🔥]"));
    equal(monthlySummary.leaderboard.find((row) => row.memberId === fixture.john.id)?.isLeader, true);
    equal(monthlySummary.leaderboard.find((row) => row.memberId === fixture.sarah.id)?.isLeader, false);
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
        proof: "https://cdn.example/12k.png",
      },
    });
    const runResponse = await handler.handleDetailed({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.john.id,
      commandName: "run-submit",
      options: {
        distance_km: 3.5,
        run_date: "2026-04-13",
        proof: "https://cdn.example/3k.png",
      },
    });
    const profileReply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.john.id,
      commandName: "profile-set",
      options: {
        image_url: "https://cdn.example/avatars/john.png",
      },
    });
    const boardReply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.john.id,
      commandName: "leaderboard",
    });
    const updatedMember = await fixture.repository.getMemberById(fixture.john.id);

    ok(goalReply.includes("90km"));
    ok(runReply.includes("Run logged: 12km on 2026-04-12"));
    equal(runResponse.runSummaryCard?.runDate, "2026-04-13");
    equal(runResponse.runSummaryCard?.distanceKm, 3.5);
    equal(runResponse.runSummaryCard?.remainingPersonalKm, 74.5);
    equal(runResponse.runSummaryCard?.submitterName, "John");
    ok(profileReply.includes("Profile image updated."));
    equal(updatedMember?.profileImageUrl, "https://cdn.example/avatars/john.png");
    equal(updatedMember?.profileImageSource, "custom_url");
    ok(boardReply.includes("**Group**"));
    ok(boardReply.includes("15.5/90km"));
    ok(boardReply.includes("**#1 · John 👑**\n15.5/90km"));
  });

  it("returns a useful receipt when a proof-backed run is submitted through Discord", async () => {
    const fixture = await createFixture();
    const handler = new DiscordCommandHandler(fixture.service, fixture.repository);

    await fixture.service.setGoal({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      memberId: fixture.john.id,
      baseGoalKm: 50,
    });
    const reply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.john.id,
      commandName: "run-submit",
      options: {
        proof: "https://cdn.example/apple-fitness.png",
        distance_km: 7.2,
        run_date: "2026-04-05",
        source: "Apple Fitness",
        note: "Evening run",
      },
    });

    ok(reply.includes("Run logged: 7.2km on 2026-04-05"));
    ok(reply.includes("Proof: Apple Fitness"));
    ok(reply.includes("Progress: 7.2/50km"));
    ok(!reply.includes("Submission ID:"));
  });

  it("shows OCR suggestions without saving when typed run fields are missing", async () => {
    const fixture = await createFixture();
    const handler = new DiscordCommandHandler(fixture.service, fixture.repository);

    const reply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.john.id,
      commandName: "run-submit",
      options: {
        proof: "https://cdn.example/ocr-proof.png",
        ocr_distance_km: 4.8,
        ocr_run_date: "2026-04-08",
      },
    });
    const summary = await fixture.service.getMonthlySummary({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
    });

    ok(reply.includes("I read 4.8km on 2026-04-08"));
    ok(reply.includes("Rerun /run-submit"));
    equal(summary.submissions.length, 0);
  });

  it("lets the assigned leader record group punishments that every member can view", async () => {
    const fixture = await createFixture();
    const handler = new DiscordCommandHandler(fixture.service, fixture.repository);

    const nonLeaderReply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.sarah.id,
      commandName: "leader-record-punishment",
      options: {
        note: "100 burpees",
      },
    });
    const leaderReply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.john.id,
      commandName: "leader-record-punishment",
      options: {
        note: "100 burpees",
      },
    });
    const punishmentsReply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.sarah.id,
      commandName: "punishments",
    });

    ok(nonLeaderReply.includes("assigned leader or an admin"));
    ok(leaderReply.includes("Group punishment recorded: 100 burpees"));
    ok(punishmentsReply.includes("**Punishments · April 2026**"));
    ok(punishmentsReply.includes("\n\n  😈 **#1** 100 burpees"));
    ok(!punishmentsReply.includes("recorded by John"));
  });

  it("lets only the assigned leader remove punishments", async () => {
    const fixture = await createFixture();
    const handler = new DiscordCommandHandler(fixture.service, fixture.repository);
    const punishment = await fixture.service.recordPunishment({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      assignedByMemberId: fixture.john.id,
      note: "100 burpees",
    });

    const nonLeaderReply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.sarah.id,
      commandName: "leader-remove-punishment",
      options: {
        punishment_number: 1,
      },
    });
    const adminNotLeaderReply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.sarah.id,
      isAdmin: true,
      commandName: "leader-remove-punishment",
      options: {
        punishment_number: 1,
      },
    });
    const leaderReply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.john.id,
      commandName: "leader-remove-punishment",
      options: {
        punishment_number: 1,
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
    ok(leaderReply.includes("Group punishment removed: 100 burpees"));
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
    ok(closeReply.includes("/leader-record-punishment note"));
  });

  it("keeps member registration idempotent for the same Discord user", async () => {
    const fixture = await createFixture();

    const updated = await fixture.service.registerMember({
      workspaceId: fixture.workspace.id,
      platform: "discord",
      externalUserId: "discord-john",
      displayName: "Johnny",
    });
    const members = await fixture.repository.listMembersByWorkspace(fixture.workspace.id);

    equal(updated.id, fixture.john.id);
    equal((await fixture.repository.listMemberIdentities(fixture.john.id)).length, 1);
    equal(updated.displayName, "Johnny");
  });

  it("rejects member registration without a platform identity", async () => {
    const fixture = await createFixture();

    await rejects(
      () => fixture.service.registerMember({
        workspaceId: fixture.workspace.id,
        displayName: "Unlinked Runner",
      }),
      /requires a platform identity/,
    );
  });

  it("links multiple platform identities to one member without changing challenge membership", async () => {
    const fixture = await createFixture();

    await fixture.service.linkMemberIdentity({
      workspaceId: fixture.workspace.id,
      memberId: fixture.john.id,
      platform: "whatsapp",
      externalUserId: "+61400000000",
    });
    await fixture.service.linkMemberIdentity({
      workspaceId: fixture.workspace.id,
      memberId: fixture.john.id,
      platform: "messenger",
      externalUserId: "messenger-john",
    });

    const identities = await fixture.repository.listMemberIdentities(fixture.john.id);
    equal(identities.length, 3);
    equal((await fixture.repository.listMembersByWorkspace(fixture.workspace.id)).length, 3);
    await rejects(
      () => fixture.service.linkMemberIdentity({
        workspaceId: fixture.workspace.id,
        memberId: fixture.sarah.id,
        platform: "whatsapp",
        externalUserId: "+61400000000",
      }),
      /already linked/,
    );
  });

  it("keeps concurrent first registrations for one platform identity idempotent", async () => {
    const fixture = await createFixture();

    const registrations = await Promise.all([
      fixture.service.registerMember({
        workspaceId: fixture.workspace.id,
        platform: "whatsapp",
        externalUserId: "+61400000001",
        displayName: "New Runner",
      }),
      fixture.service.registerMember({
        workspaceId: fixture.workspace.id,
        platform: "whatsapp",
        externalUserId: "+61400000001",
        displayName: "New Runner",
      }),
    ]);

    equal(registrations[0]?.id, registrations[1]?.id);
    equal((await fixture.repository.listMemberIdentities(registrations[0]!.id)).length, 1);
  });

  it("keeps concurrent platform workspace resolution idempotent", async () => {
    const repository = new InMemoryChallengeRepository();
    const service = new ChallengeService(repository);

    const workspaces = await Promise.all([
      service.getOrCreateWorkspaceForIntegration({
        name: "Run Club",
        timezone: "Australia/Sydney",
        platform: "messenger",
        externalWorkspaceId: "thread-1",
      }),
      service.getOrCreateWorkspaceForIntegration({
        name: "Run Club",
        timezone: "Australia/Sydney",
        platform: "messenger",
        externalWorkspaceId: "thread-1",
      }),
    ]);

    equal(workspaces[0]?.id, workspaces[1]?.id);
    equal((await repository.listWorkspaces()).length, 1);
  });

  it("reconciles a member retry after identity persistence fails", async () => {
    const repository = new FailsFirstMemberIdentitySaveRepository();
    const service = new ChallengeService(repository);
    const workspace = await service.createWorkspace({ name: "Run Club", timezone: "Australia/Sydney" });
    const input = {
      workspaceId: workspace.id,
      platform: "whatsapp",
      externalUserId: "+61400000002",
      displayName: "Retry Runner",
    };

    await rejects(() => service.registerMember(input), /identity persistence failure/);
    const member = await service.registerMember(input);

    equal((await repository.listMembersByWorkspace(workspace.id)).length, 1);
    equal((await repository.getMemberIdentity(workspace.id, "whatsapp", input.externalUserId))?.memberId, member.id);
  });

  it("reconciles a workspace retry after integration persistence fails", async () => {
    const repository = new FailsFirstWorkspaceIntegrationSaveRepository();
    const service = new ChallengeService(repository);
    const input = {
      name: "Run Club",
      timezone: "Australia/Sydney",
      platform: "messenger",
      externalWorkspaceId: "thread-2",
    };

    await rejects(() => service.getOrCreateWorkspaceForIntegration(input), /integration persistence failure/);
    const workspace = await service.getOrCreateWorkspaceForIntegration(input);

    equal((await repository.listWorkspaces()).length, 1);
    equal((await service.getWorkspaceByIntegration("messenger", "thread-2"))?.id, workspace.id);
  });

  it("rejects invalid command month, non-finite goal distance, out-of-month runs, and invalid profile images", async () => {
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
        proof: "https://cdn.example/wrong-month.png",
      },
    });
    const invalidProfileReply = await handler.handle({
      workspaceId: fixture.workspace.id,
      month: fixture.month,
      actorMemberId: fixture.john.id,
      commandName: "profile-set",
      options: {
        image_url: "ftp://cdn.example/avatar.png",
      },
    });

    ok(invalidMonthReply.includes("Invalid month"));
    ok(invalidGoalReply.startsWith("Error:"));
    ok(invalidRunReply.includes("inside the challenge month"));
    ok(invalidProfileReply.includes("valid http or https URL"));
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

  it("keeps the public Momentum surface free of Discord dependencies", async () => {
    const files = [
      "src/momentum/index.ts",
      "src/core/types.ts",
      "src/core/runtime.ts",
      "src/services/challengeService.ts",
      "src/repositories/challengeRepository.ts",
    ];
    const source = await Promise.all(files.map((file) => readFile(file, "utf8")));

    for (const content of source) {
      ok(!content.includes("discord.js"));
      ok(!content.includes("adapters/discord"));
    }
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

  it("migrates legacy Discord snapshots into generic integrations and identities", async () => {
    const filePath = `.tmp/test-legacy-${Date.now()}-${Math.random().toString(16).slice(2)}.json`;
    await writeFile(filePath, JSON.stringify({
      workspaces: [{
        id: "workspace-1",
        name: "Legacy Club",
        discordGuildId: "guild-1",
        timezone: "Australia/Sydney",
        channelRefs: { announcements: "announcements" },
        createdAt: "2026-04-01T00:00:00.000Z",
      }],
      members: [{
        id: "member-1",
        workspaceId: "workspace-1",
        discordUserId: "discord-john",
        displayName: "John",
        profileImageSource: "discord_avatar",
        createdAt: "2026-04-01T00:00:00.000Z",
      }],
      prompts: [{
        id: "prompt-1",
        workspaceId: "workspace-1",
        challengeId: "challenge-1",
        month: "2026-04",
        kind: "month_start",
        scheduledFor: "2026-04-01T00:00:00.000Z",
        channelKey: "announcements",
      }],
    }));

    const repository = new JsonFileChallengeRepository(filePath);
    await repository.init();
    const service = new ChallengeService(repository);
    const workspace = await service.getWorkspaceByIntegration("discord", "guild-1");
    const identity = await repository.getMemberIdentity("workspace-1", "discord", "discord-john");
    const persisted = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;

    equal(workspace?.id, "workspace-1");
    equal(identity?.memberId, "member-1");
    equal(identity?.id, memberIdentityId("workspace-1", "discord", "discord-john"));
    equal((await repository.listNotificationIntentsByChallenge("challenge-1"))[0]?.audience, "workspace");
    ok(Array.isArray(persisted.workspaceIntegrations));
    ok(Array.isArray(persisted.memberIdentities));
    ok(Array.isArray(persisted.notificationIntents));
    equal((persisted.workspaces as Array<Record<string, unknown>>)[0]?.discordGuildId, undefined);
  });

  it("migrates the same legacy Discord user in separate workspaces", async () => {
    const filePath = `.tmp/test-legacy-multi-${Date.now()}-${Math.random().toString(16).slice(2)}.json`;
    await writeFile(filePath, JSON.stringify({
      workspaces: [
        { id: "workspace-1", name: "One", discordGuildId: "guild-1", timezone: "UTC", createdAt: "2026-04-01T00:00:00.000Z" },
        { id: "workspace-2", name: "Two", discordGuildId: "guild-2", timezone: "UTC", createdAt: "2026-04-01T00:00:00.000Z" },
      ],
      members: [
        { id: "member-1", workspaceId: "workspace-1", discordUserId: "discord-john", displayName: "John", createdAt: "2026-04-01T00:00:00.000Z" },
        { id: "member-2", workspaceId: "workspace-2", discordUserId: "discord-john", displayName: "John", createdAt: "2026-04-01T00:00:00.000Z" },
      ],
    }));

    const repository = new JsonFileChallengeRepository(filePath);
    await repository.init();

    equal((await repository.getMemberIdentity("workspace-1", "discord", "discord-john"))?.memberId, "member-1");
    equal((await repository.getMemberIdentity("workspace-2", "discord", "discord-john"))?.memberId, "member-2");
  });

});
