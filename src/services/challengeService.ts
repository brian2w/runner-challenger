import {
  buildGroupProgressSummary,
  buildLeaderboardRows,
  buildMemberMonthStatuses,
  buildMonthlyResult,
  computeEffectiveGoal,
} from "../core/calculations.js";
import { DomainError } from "../core/errors.js";
import { memberId, memberIdentityId, workspaceIdForIntegration, workspaceIntegrationId } from "../core/identityIds.js";
import { addDays, isIsoDate, isIsoDateInMonth, monthCloseIso, monthStartIso, nextMonth } from "../core/time.js";
import { systemMomentumRuntime, type MomentumRuntime } from "../core/runtime.js";
import type {
  CarryoverPenalty,
  NotificationAudience,
  NotificationIntent,
  GroupProgressSummary,
  LeaderAssignment,
  LeaderboardRow,
  Member,
  MemberMonthStatus,
  MonthCloseSummary,
  MonthKey,
  MonthlyChallenge,
  MonthlyGoal,
  PromptKind,
  PunishmentRecord,
  RunSubmission,
  Workspace,
} from "../core/types.js";
import type { ChallengeRepository } from "../repositories/challengeRepository.js";

type RegisterMemberInput = {
  workspaceId: string;
  displayName: string;
  profileImageUrl?: string;
  profileImageSource?: Member["profileImageSource"];
  isBot?: boolean;
  platform?: string;
  externalUserId?: string;
};

type LegacyDiscordIdentityInput = {
  discordUserId?: string;
};

type LegacyDiscordWorkspaceInput = {
  discordGuildId?: string;
};

export class ChallengeService {
  private readonly memberRegistrationLocks = new Map<string, Promise<Member>>();
  private readonly workspaceIntegrationLocks = new Map<string, Promise<Workspace>>();
  constructor(
    private readonly repository: ChallengeRepository,
    private readonly runtime: MomentumRuntime = systemMomentumRuntime,
  ) {}

  async createWorkspace<T extends { name: string; timezone: string }>(input: T): Promise<Workspace> {
    const legacyInput = input as T & LegacyDiscordWorkspaceInput;
    const workspace: Workspace = {
      id: legacyInput.discordGuildId
        ? workspaceIdForIntegration("discord", legacyInput.discordGuildId)
        : this.runtime.createId(),
      name: input.name,
      timezone: input.timezone,
      createdAt: this.runtime.now(),
    };
    if (legacyInput.discordGuildId) {
      await this.reserveWorkspaceIntegration({
        workspaceId: workspace.id,
        platform: "discord",
        externalWorkspaceId: legacyInput.discordGuildId,
      });
    }
    await this.repository.saveWorkspace(workspace);
    return workspace;
  }

  async registerMember<T extends RegisterMemberInput>(input: T): Promise<Member> {
    const legacyInput = input as T & LegacyDiscordIdentityInput;
    const platform = input.platform ?? (legacyInput.discordUserId ? "discord" : "legacy");
    const externalUserId = input.externalUserId ?? legacyInput.discordUserId;
    if (!externalUserId) {
      throw new DomainError("Member registration requires a platform identity.");
    }
    const key = `${input.workspaceId}:${platform}:${externalUserId}`;
    const activeRegistration = this.memberRegistrationLocks.get(key);
    if (activeRegistration) {
      return activeRegistration;
    }

    const registration = this.registerMemberWithIdentity(input, platform, externalUserId);
    this.memberRegistrationLocks.set(key, registration);
    try {
      return await registration;
    } finally {
      if (this.memberRegistrationLocks.get(key) === registration) {
        this.memberRegistrationLocks.delete(key);
      }
    }
  }

  private async registerMemberWithIdentity<T extends RegisterMemberInput>(
    input: T,
    platform: string,
    externalUserId: string,
  ): Promise<Member> {
    await this.requireWorkspace(input.workspaceId);
    const existingIdentity = await this.repository.getMemberIdentity(
      input.workspaceId,
      platform,
      externalUserId,
    );
    const existing = existingIdentity ? await this.repository.getMemberById(existingIdentity.memberId) : undefined;
    if (existingIdentity && !existing) {
      throw new DomainError("Member identity is linked to a missing member.");
    }
    if (existing) {
      const nextIsBot = input.isBot ?? existing.isBot;
      const shouldRefreshPlatformProfile = Boolean(input.profileImageUrl) && existing.profileImageSource !== "custom_url";
      const nextProfileImageUrl = shouldRefreshPlatformProfile ? input.profileImageUrl : existing.profileImageUrl;
      const nextProfileImageSource = shouldRefreshPlatformProfile
        ? input.profileImageSource ?? "platform_avatar"
        : existing.profileImageSource;
      if (
        existing.displayName === input.displayName &&
        existing.isBot === nextIsBot &&
        existing.profileImageUrl === nextProfileImageUrl &&
        existing.profileImageSource === nextProfileImageSource
      ) {
        return existing;
      }

      const updated: Member = {
        ...existing,
        displayName: input.displayName,
        profileImageUrl: nextProfileImageUrl,
        profileImageSource: nextProfileImageSource,
        isBot: nextIsBot,
      };
      await this.repository.saveMember(updated);
      return updated;
    }

    const member: Member = {
      id: memberId(input.workspaceId, platform, externalUserId),
      workspaceId: input.workspaceId,
      displayName: input.displayName,
      profileImageUrl: input.profileImageUrl,
      profileImageSource: input.profileImageUrl ? input.profileImageSource ?? "platform_avatar" : undefined,
      isBot: input.isBot,
      createdAt: this.runtime.now(),
    };
    await this.repository.saveMember(member);
    await this.repository.saveMemberIdentity({
      id: memberIdentityId(input.workspaceId, platform, externalUserId),
      workspaceId: input.workspaceId,
      memberId: member.id,
      platform,
      externalUserId,
      createdAt: this.runtime.now(),
    });
    return member;
  }

  async linkMemberIdentity(input: {
    workspaceId: string;
    memberId: string;
    platform: string;
    externalUserId: string;
  }): Promise<void> {
    await this.requireMember(input.memberId, input.workspaceId);
    const existing = await this.repository.getMemberIdentity(
      input.workspaceId,
      input.platform,
      input.externalUserId,
    );
    if (existing?.memberId === input.memberId) {
      return;
    }
    if (existing) {
      throw new DomainError("This platform identity is already linked to another member.");
    }
    await this.repository.saveMemberIdentity({
      id: memberIdentityId(input.workspaceId, input.platform, input.externalUserId),
      ...input,
      createdAt: this.runtime.now(),
    });
  }

  async getWorkspaceByIntegration(platform: string, externalWorkspaceId: string): Promise<Workspace | undefined> {
    const integration = await this.repository.getWorkspaceIntegration(platform, externalWorkspaceId);
    return integration ? this.repository.getWorkspaceById(integration.workspaceId) : undefined;
  }

  async getOrCreateWorkspaceForIntegration(input: {
    name: string;
    timezone: string;
    platform: string;
    externalWorkspaceId: string;
  }): Promise<Workspace> {
    const key = `${input.platform}:${input.externalWorkspaceId}`;
    const activeResolution = this.workspaceIntegrationLocks.get(key);
    if (activeResolution) {
      return activeResolution;
    }

    const resolution = (async () => {
      const existing = await this.getWorkspaceByIntegration(input.platform, input.externalWorkspaceId);
      if (existing) {
        return existing;
      }
      const workspace = await this.createWorkspaceWithId({
        id: workspaceIdForIntegration(input.platform, input.externalWorkspaceId),
        name: input.name,
        timezone: input.timezone,
        createdAt: this.runtime.now(),
      });
      await this.connectWorkspace({
        workspaceId: workspace.id,
        platform: input.platform,
        externalWorkspaceId: input.externalWorkspaceId,
      });
      return workspace;
    })();
    this.workspaceIntegrationLocks.set(key, resolution);
    try {
      return await resolution;
    } finally {
      if (this.workspaceIntegrationLocks.get(key) === resolution) {
        this.workspaceIntegrationLocks.delete(key);
      }
    }
  }

  async connectWorkspace(input: {
    workspaceId: string;
    platform: string;
    externalWorkspaceId: string;
  }): Promise<void> {
    await this.requireWorkspace(input.workspaceId);
    await this.reserveWorkspaceIntegration(input);
  }

  private async reserveWorkspaceIntegration(input: {
    workspaceId: string;
    platform: string;
    externalWorkspaceId: string;
  }): Promise<void> {
    const existing = await this.repository.getWorkspaceIntegration(input.platform, input.externalWorkspaceId);
    if (existing && existing.workspaceId !== input.workspaceId) {
      throw new DomainError("This platform workspace is already connected to another workspace.");
    }
    if (!existing) {
      await this.repository.saveWorkspaceIntegration({
        id: workspaceIntegrationId(input.platform, input.externalWorkspaceId),
        ...input,
        createdAt: this.runtime.now(),
      });
    }
  }

  async getMember(memberId: string, workspaceId: string): Promise<Member | undefined> {
    const member = await this.repository.getMemberById(memberId);
    return member?.workspaceId === workspaceId ? member : undefined;
  }

  async listMembers(workspaceId: string): Promise<Member[]> {
    await this.requireWorkspace(workspaceId);
    return this.repository.listMembersByWorkspace(workspaceId);
  }

  async setMemberProfileImage(input: {
    workspaceId: string;
    memberId: string;
    imageUrl: string;
  }): Promise<Member> {
    const member = await this.requireParticipantMember(input.memberId, input.workspaceId);
    const updated: Member = {
      ...member,
      profileImageUrl: this.requireHttpUrl(input.imageUrl),
      profileImageSource: "custom_url",
    };
    await this.repository.saveMember(updated);
    return updated;
  }

  async startMonth(input: { workspaceId: string; month: MonthKey }): Promise<MonthlyChallenge> {
    await this.requireWorkspace(input.workspaceId);
    const existing = await this.repository.getChallengeByMonth(input.workspaceId, input.month);
    if (existing) {
      await this.ensureDefaultNotificationIntents(existing);
      return existing;
    }

    const challenge: MonthlyChallenge = {
      id: this.runtime.createId(),
      workspaceId: input.workspaceId,
      month: input.month,
      kind: "monthly_distance_km",
      status: "open",
      createdAt: this.runtime.now(),
    };
    await this.repository.saveChallenge(challenge);
    await this.ensureDefaultNotificationIntents(challenge);

    return challenge;
  }

  async assignLeader(input: { workspaceId: string; month: MonthKey; memberId: string }): Promise<LeaderAssignment> {
    const challenge = await this.requireChallenge(input.workspaceId, input.month);
    await this.requireParticipantMember(input.memberId, input.workspaceId);

    const assignment: LeaderAssignment = {
      id: this.runtime.createId(),
      workspaceId: input.workspaceId,
      challengeId: challenge.id,
      memberId: input.memberId,
      assignedAt: this.runtime.now(),
    };
    await this.repository.saveLeaderAssignment(assignment);
    return assignment;
  }

  async setGoal(input: {
    workspaceId: string;
    month: MonthKey;
    memberId: string;
    baseGoalKm: number;
  }): Promise<MonthlyGoal> {
    const challenge = await this.requireOpenChallenge(input.workspaceId, input.month);
    await this.requireParticipantMember(input.memberId, input.workspaceId);
    if (!Number.isFinite(input.baseGoalKm) || input.baseGoalKm <= 0) {
      throw new DomainError("Goal distance must be greater than zero.");
    }

    const carryoverKm = await this.getCarryoverForMember(input.workspaceId, input.month, input.memberId);
    const existing = await this.repository.getGoal(challenge.id, input.memberId);
    const timestamp = this.runtime.now();
    const goal: MonthlyGoal = {
      id: existing?.id ?? this.runtime.createId(),
      workspaceId: input.workspaceId,
      challengeId: challenge.id,
      memberId: input.memberId,
      baseGoalKm: input.baseGoalKm,
      carryoverKm,
      effectiveGoalKm: computeEffectiveGoal(input.baseGoalKm, carryoverKm),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    await this.repository.saveGoal(goal);
    return goal;
  }

  async submitManualRun(input: {
    workspaceId: string;
    month: MonthKey;
    memberId: string;
    distanceKm: number;
    runDate: string;
    evidenceUrl: string;
  }): Promise<RunSubmission> {
    return this.submitRunProof({
      ...input,
      evidenceLabel: "Screenshot",
    });
  }

  async submitRunProof(input: {
    workspaceId: string;
    month: MonthKey;
    memberId: string;
    distanceKm: number;
    runDate: string;
    evidenceUrl: string;
    evidenceLabel?: string;
    userNote?: string;
  }): Promise<RunSubmission> {
    const challenge = await this.requireOpenChallenge(input.workspaceId, input.month);
    await this.requireParticipantMember(input.memberId, input.workspaceId);
    if (!input.evidenceUrl) {
      throw new DomainError("Run submissions require proof.");
    }
    if (!Number.isFinite(input.distanceKm) || input.distanceKm <= 0) {
      throw new DomainError("Run distance must be greater than zero.");
    }
    if (!isIsoDateInMonth(input.runDate, input.month)) {
      throw new DomainError("Run date must be a valid date inside the challenge month.");
    }

    const submission: RunSubmission = {
      id: this.runtime.createId(),
      workspaceId: input.workspaceId,
      challengeId: challenge.id,
      memberId: input.memberId,
      sourceType: "proof_attachment",
      distanceKm: input.distanceKm,
      runDate: input.runDate,
      evidenceUrl: input.evidenceUrl,
      evidenceLabel: input.evidenceLabel,
      userNote: input.userNote,
      status: "accepted",
      acceptedAt: this.runtime.now(),
    };
    await this.repository.saveSubmission(submission);
    return submission;
  }

  async overrideRun(input: {
    workspaceId: string;
    month: MonthKey;
    submissionId: string;
    action: "remove" | "replace_distance";
    distanceKm?: number;
    note: string;
  }): Promise<RunSubmission> {
    const challenge = await this.requireChallenge(input.workspaceId, input.month);
    const submission = await this.repository.getSubmissionById(input.submissionId);
    if (!submission || submission.challengeId !== challenge.id) {
      throw new DomainError("Submission was not found for that month.");
    }

    let updatedDistance = submission.distanceKm;
    let status: RunSubmission["status"] = "corrected";

    if (input.action === "remove") {
      status = "removed";
      updatedDistance = 0;
    }

    if (input.action === "replace_distance") {
      if (!input.distanceKm || !Number.isFinite(input.distanceKm) || input.distanceKm <= 0) {
        throw new DomainError("Replacement distance must be greater than zero.");
      }
      updatedDistance = input.distanceKm;
    }

    const updated: RunSubmission = {
      ...submission,
      distanceKm: updatedDistance,
      status,
      note: input.note,
    };
    await this.repository.saveSubmission(updated);
    return updated;
  }

  async recordPunishment(input: {
    workspaceId: string;
    month: MonthKey;
    assignedByMemberId: string;
    note: string;
  }): Promise<PunishmentRecord> {
    const challenge = await this.requireChallenge(input.workspaceId, input.month);
    await this.requireParticipantMember(input.assignedByMemberId, input.workspaceId);

    const record: PunishmentRecord = {
      id: this.runtime.createId(),
      workspaceId: input.workspaceId,
      challengeId: challenge.id,
      assignedByMemberId: input.assignedByMemberId,
      note: input.note,
      createdAt: this.runtime.now(),
    };
    await this.repository.savePunishmentRecord(record);
    return record;
  }

  async listPunishments(input: {
    workspaceId: string;
    month: MonthKey;
  }): Promise<PunishmentRecord[]> {
    const challenge = await this.requireChallenge(input.workspaceId, input.month);
    const punishments = await this.repository.listPunishmentsByChallenge(challenge.id);
    return punishments
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async removePunishment(input: {
    workspaceId: string;
    month: MonthKey;
    punishmentId: string;
  }): Promise<PunishmentRecord> {
    const challenge = await this.requireChallenge(input.workspaceId, input.month);
    const punishment = await this.repository.getPunishmentById(input.punishmentId);
    if (!punishment || punishment.workspaceId !== input.workspaceId || punishment.challengeId !== challenge.id) {
      throw new DomainError("Punishment was not found for that month.");
    }

    await this.repository.deletePunishmentRecord(input.punishmentId);
    return punishment;
  }

  async closeMonth(input: { workspaceId: string; month: MonthKey }): Promise<MonthCloseSummary> {
    const challenge = await this.requireChallenge(input.workspaceId, input.month);
    const members = await this.repository.listMembersByWorkspace(input.workspaceId);
    const goals = await this.repository.listGoalsByChallenge(challenge.id);
    const submissions = await this.repository.listSubmissionsByChallenge(challenge.id);
    const existingResults = await this.repository.listMonthlyResultsByChallenge(challenge.id);
    const existingResultsByMember = new Map(existingResults.map((result) => [result.memberId, result]));
    const targetMonth = nextMonth(input.month);
    const existingCarryovers = await this.repository.listCarryoversByTargetMonth(input.workspaceId, targetMonth);
    const existingCarryoversByMember = this.carryoversByMemberForSourceChallenge(existingCarryovers, challenge.id);
    const existingCloseCutoff = existingResults.map((result) => result.closedAt).sort()[0];
    const membersForClose =
      existingCloseCutoff !== undefined
        ? members.filter(
            (member) => existingResultsByMember.has(member.id) || member.createdAt <= existingCloseCutoff,
          )
        : members;
    const statuses = buildMemberMonthStatuses(membersForClose, goals, submissions);
    const closedAt = challenge.closedAt ?? existingCloseCutoff ?? this.runtime.now();
    const results: MonthCloseSummary["results"] = [];

    for (const status of statuses) {
      const existingResult = existingResultsByMember.get(status.memberId);
      const result = {
        id: existingResult?.id ?? this.monthlyResultId(challenge.id, status.memberId),
        ...buildMonthlyResult(status.memberId, closedAt, challenge.id, input.workspaceId, status),
      };
      results.push(result);
      await this.repository.saveMonthlyResult(result);

      const existingCarryover = existingCarryoversByMember.get(result.memberId);
      if (result.generatedCarryoverKm > 0 || existingCarryover) {
        const carryover: CarryoverPenalty = {
          id: existingCarryover?.id ?? this.carryoverPenaltyId(challenge.id, result.memberId),
          workspaceId: input.workspaceId,
          memberId: result.memberId,
          sourceChallengeId: challenge.id,
          targetMonth,
          amountKm: result.generatedCarryoverKm,
          createdAt: existingCarryover?.createdAt ?? closedAt,
        };
        await this.repository.saveCarryoverPenalty(carryover);
      }
    }

    const closedChallenge: MonthlyChallenge = {
      ...challenge,
      status: "closed",
      closedAt,
    };
    await this.repository.saveChallenge(closedChallenge);

    const leader = await this.repository.getLeaderAssignmentByChallenge(challenge.id);
    return {
      workspaceId: input.workspaceId,
      challengeId: challenge.id,
      month: input.month,
      leaderId: leader?.memberId,
      results,
    };
  }

  async getLeaderboard(input: { workspaceId: string; month: MonthKey }): Promise<LeaderboardRow[]> {
    const challenge = await this.requireChallenge(input.workspaceId, input.month);
    const [statuses, leader] = await Promise.all([
      this.getMemberStatuses(input.workspaceId, challenge.id),
      this.repository.getLeaderAssignmentByChallenge(challenge.id),
    ]);
    return buildLeaderboardRows(statuses, leader?.memberId);
  }

  async getGroupProgress(input: { workspaceId: string; month: MonthKey }): Promise<GroupProgressSummary> {
    const challenge = await this.requireChallenge(input.workspaceId, input.month);
    const statuses = await this.getMemberStatuses(input.workspaceId, challenge.id);
    return buildGroupProgressSummary(statuses);
  }

  async getMemberStatuses(workspaceId: string, challengeId: string): Promise<MemberMonthStatus[]> {
    const [members, goals, submissions] = await Promise.all([
      this.repository.listMembersByWorkspace(workspaceId),
      this.repository.listGoalsByChallenge(challengeId),
      this.repository.listSubmissionsByChallenge(challengeId),
    ]);

    return buildMemberMonthStatuses(members, goals, submissions);
  }

  async getMonthlySummary(input: { workspaceId: string; month: MonthKey }): Promise<{
    challenge: MonthlyChallenge;
    goals: MonthlyGoal[];
    submissions: RunSubmission[];
    leaderboard: LeaderboardRow[];
    leaderId?: string;
    notificationIntents: NotificationIntent[];
  }> {
    const challenge = await this.requireChallenge(input.workspaceId, input.month);
    const [goals, submissions, leaderboard, leader, notificationIntents] = await Promise.all([
      this.repository.listGoalsByChallenge(challenge.id),
      this.repository.listSubmissionsByChallenge(challenge.id),
      this.getLeaderboard(input),
      this.repository.getLeaderAssignmentByChallenge(challenge.id),
      this.repository.listNotificationIntentsByChallenge(challenge.id),
    ]);

    return {
      challenge,
      goals,
      submissions,
      leaderboard,
      leaderId: leader?.memberId,
      notificationIntents,
    };
  }

  private buildDefaultNotificationIntents(challenge: MonthlyChallenge): NotificationIntent[] {
    const start = monthStartIso(challenge.month);
    const close = monthCloseIso(challenge.month);
    const notifications: Array<{ kind: PromptKind; offsetDays: number; audience: NotificationAudience }> = [
      { kind: "month_start", offsetDays: 0, audience: "workspace" },
      { kind: "leaderboard_update", offsetDays: 3, audience: "workspace" },
      { kind: "weekly_reminder", offsetDays: 7, audience: "workspace" },
      { kind: "leaderboard_update", offsetDays: 10, audience: "workspace" },
      { kind: "weekly_reminder", offsetDays: 14, audience: "workspace" },
      { kind: "leaderboard_update", offsetDays: 17, audience: "workspace" },
      { kind: "weekly_reminder", offsetDays: 21, audience: "workspace" },
      { kind: "leaderboard_update", offsetDays: 24, audience: "workspace" },
    ];

    return [
      ...notifications.map((notification) => ({
        id: this.notificationIntentId(challenge.id, notification.kind, notification.offsetDays, notification.audience),
        workspaceId: challenge.workspaceId,
        challengeId: challenge.id,
        month: challenge.month,
        kind: notification.kind,
        scheduledFor: addDays(start, notification.offsetDays),
        audience: notification.audience,
      })),
      {
        id: this.notificationIntentId(challenge.id, "month_close", -1, "workspace"),
        workspaceId: challenge.workspaceId,
        challengeId: challenge.id,
        month: challenge.month,
        kind: "month_close",
        scheduledFor: close,
        audience: "workspace",
      },
    ];
  }

  private async ensureDefaultNotificationIntents(challenge: MonthlyChallenge): Promise<void> {
    const existingIntents = await this.repository.listNotificationIntentsByChallenge(challenge.id);
    const existingIntentsByKey = new Map(
      existingIntents.map((intent) => [this.notificationIntentKey(intent), intent]),
    );

    for (const intent of this.buildDefaultNotificationIntents(challenge)) {
      const existingIntent = existingIntentsByKey.get(this.notificationIntentKey(intent));
      if (!existingIntent || existingIntent.id === intent.id) {
        await this.repository.saveNotificationIntent({
          ...intent,
          deliveredAt: existingIntent?.deliveredAt,
        });
      }
    }
  }

  private notificationIntentKey(intent: Pick<NotificationIntent, "kind" | "scheduledFor" | "audience">): string {
    return `${intent.kind}:${intent.scheduledFor}:${intent.audience}`;
  }

  private notificationIntentId(
    challengeId: string,
    kind: PromptKind,
    offsetDays: number,
    audience: NotificationAudience,
  ): string {
    return `notification-intent:${challengeId}:${kind}:${offsetDays}:${audience}`;
  }

  private async createWorkspaceWithId(input: Workspace): Promise<Workspace> {
    await this.repository.saveWorkspace(input);
    return input;
  }

  private monthlyResultId(challengeId: string, memberId: string): string {
    return `monthly-result:${challengeId}:${memberId}`;
  }

  private carryoverPenaltyId(challengeId: string, memberId: string): string {
    return `carryover-penalty:${challengeId}:${memberId}`;
  }

  private carryoversByMemberForSourceChallenge(
    carryovers: CarryoverPenalty[],
    sourceChallengeId: string,
  ): Map<string, CarryoverPenalty> {
    const carryoversByMember = new Map<string, CarryoverPenalty[]>();
    for (const carryover of carryovers) {
      if (carryover.sourceChallengeId === sourceChallengeId) {
        carryoversByMember.set(carryover.memberId, [...(carryoversByMember.get(carryover.memberId) ?? []), carryover]);
      }
    }

    return new Map(
      [...carryoversByMember.entries()].map(([memberId, memberCarryovers]) => [
        memberId,
        this.selectCarryoverForSourceMember(sourceChallengeId, memberId, memberCarryovers),
      ]),
    );
  }

  private selectCarryoverForSourceMember(
    sourceChallengeId: string,
    memberId: string,
    carryovers: CarryoverPenalty[],
  ): CarryoverPenalty {
    const deterministicId = this.carryoverPenaltyId(sourceChallengeId, memberId);
    const deterministicCarryover = carryovers.find((carryover) => carryover.id === deterministicId);
    if (deterministicCarryover) {
      return deterministicCarryover;
    }

    return [...carryovers].sort(
      (left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
    )[0]!;
  }

  private async getCarryoverForMember(
    workspaceId: string,
    month: MonthKey,
    memberId: string,
  ): Promise<number> {
    const carryovers = await this.repository.listCarryoversByTargetMonth(workspaceId, month);
    const carryoversBySourceChallenge = new Map<string, CarryoverPenalty[]>();
    for (const carryover of carryovers) {
      if (carryover.memberId === memberId) {
        carryoversBySourceChallenge.set(carryover.sourceChallengeId, [
          ...(carryoversBySourceChallenge.get(carryover.sourceChallengeId) ?? []),
          carryover,
        ]);
      }
    }

    return [...carryoversBySourceChallenge.entries()]
      .map(([sourceChallengeId, sourceCarryovers]) =>
        this.selectCarryoverForSourceMember(sourceChallengeId, memberId, sourceCarryovers),
      )
      .reduce((total, carryover) => total + carryover.amountKm, 0);
  }

  private async requireWorkspace(workspaceId: string): Promise<Workspace> {
    const workspace = await this.repository.getWorkspaceById(workspaceId);
    if (!workspace) {
      throw new DomainError("Workspace does not exist.");
    }
    return workspace;
  }

  private async requireMember(memberId: string, workspaceId: string): Promise<Member> {
    const member = await this.repository.getMemberById(memberId);
    if (!member || member.workspaceId !== workspaceId) {
      throw new DomainError("Member does not exist in that workspace.");
    }
    return member;
  }

  private async requireParticipantMember(memberId: string, workspaceId: string): Promise<Member> {
    const member = await this.requireMember(memberId, workspaceId);
    if (member.isBot) {
      throw new DomainError("Bot accounts cannot participate in challenges.");
    }
    return member;
  }

  private requireHttpUrl(value: string): string {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Unsupported protocol.");
      }
      return url.toString();
    } catch {
      throw new DomainError("Profile image URL must be a valid http or https URL.");
    }
  }

  private async requireChallenge(workspaceId: string, month: MonthKey): Promise<MonthlyChallenge> {
    const challenge = await this.repository.getChallengeByMonth(workspaceId, month);
    if (!challenge) {
      throw new DomainError("Challenge month has not been started.");
    }
    return challenge;
  }

  private async requireOpenChallenge(workspaceId: string, month: MonthKey): Promise<MonthlyChallenge> {
    const challenge = await this.requireChallenge(workspaceId, month);
    if (challenge.status !== "open") {
      throw new DomainError("Challenge month is already closed.");
    }
    return challenge;
  }
}
