import { randomUUID } from "node:crypto";
import { buildLeaderboardRows, buildMemberMonthStatuses, buildMonthlyResult, computeEffectiveGoal } from "../core/calculations.js";
import { DomainError } from "../core/errors.js";
import { addDays, isIsoDate, isIsoDateInMonth, monthCloseIso, monthStartIso, nextMonth, nowIso } from "../core/time.js";
import type {
  CarryoverPenalty,
  DiscordWorkspace,
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
  ScheduledPrompt,
  StravaActivity,
} from "../core/types.js";
import type { ChallengeRepository } from "../repositories/challengeRepository.js";
import type { StravaProvider } from "../adapters/strava/stravaProvider.js";

export class ChallengeService {
  constructor(
    private readonly repository: ChallengeRepository,
    private readonly stravaProvider?: StravaProvider,
  ) {}

  async createWorkspace(input: {
    name: string;
    discordGuildId: string;
    timezone: string;
    channelRefs: DiscordWorkspace["channelRefs"];
  }): Promise<DiscordWorkspace> {
    const workspace: DiscordWorkspace = {
      id: randomUUID(),
      name: input.name,
      discordGuildId: input.discordGuildId,
      timezone: input.timezone,
      channelRefs: input.channelRefs,
      createdAt: nowIso(),
    };
    await this.repository.saveWorkspace(workspace);
    return workspace;
  }

  async registerMember(input: {
    workspaceId: string;
    discordUserId: string;
    displayName: string;
    connectedStravaAthleteId?: string;
  }): Promise<Member> {
    await this.requireWorkspace(input.workspaceId);
    const existing = await this.repository.getMemberByDiscordUserId(input.workspaceId, input.discordUserId);
    if (existing) {
      const updated: Member = {
        ...existing,
        displayName: input.displayName,
        connectedStravaAthleteId: input.connectedStravaAthleteId ?? existing.connectedStravaAthleteId,
      };
      await this.repository.saveMember(updated);
      return updated;
    }

    const member: Member = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      discordUserId: input.discordUserId,
      displayName: input.displayName,
      connectedStravaAthleteId: input.connectedStravaAthleteId,
      createdAt: nowIso(),
    };
    await this.repository.saveMember(member);
    return member;
  }

  async startMonth(input: { workspaceId: string; month: MonthKey }): Promise<MonthlyChallenge> {
    await this.requireWorkspace(input.workspaceId);
    const existing = await this.repository.getChallengeByMonth(input.workspaceId, input.month);
    if (existing) {
      return existing;
    }

    const challenge: MonthlyChallenge = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      month: input.month,
      kind: "monthly_distance_km",
      status: "open",
      createdAt: nowIso(),
    };
    await this.repository.saveChallenge(challenge);

    const prompts = this.buildDefaultPrompts(challenge);
    await Promise.all(prompts.map((prompt) => this.repository.saveScheduledPrompt(prompt)));

    return challenge;
  }

  async assignLeader(input: { workspaceId: string; month: MonthKey; memberId: string }): Promise<LeaderAssignment> {
    const challenge = await this.requireChallenge(input.workspaceId, input.month);
    await this.requireMember(input.memberId, input.workspaceId);

    const assignment: LeaderAssignment = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      challengeId: challenge.id,
      memberId: input.memberId,
      assignedAt: nowIso(),
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
    await this.requireMember(input.memberId, input.workspaceId);
    if (!Number.isFinite(input.baseGoalKm) || input.baseGoalKm <= 0) {
      throw new DomainError("Goal distance must be greater than zero.");
    }

    const carryoverKm = await this.getCarryoverForMember(input.workspaceId, input.month, input.memberId);
    const existing = await this.repository.getGoal(challenge.id, input.memberId);
    const timestamp = nowIso();
    const goal: MonthlyGoal = {
      id: existing?.id ?? randomUUID(),
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
    const challenge = await this.requireOpenChallenge(input.workspaceId, input.month);
    await this.requireMember(input.memberId, input.workspaceId);
    if (!input.evidenceUrl) {
      throw new DomainError("Manual submissions require a screenshot evidence URL.");
    }
    if (!Number.isFinite(input.distanceKm) || input.distanceKm <= 0) {
      throw new DomainError("Run distance must be greater than zero.");
    }
    if (!isIsoDateInMonth(input.runDate, input.month)) {
      throw new DomainError("Run date must be a valid date inside the challenge month.");
    }

    const submission: RunSubmission = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      challengeId: challenge.id,
      memberId: input.memberId,
      sourceType: "manual_screenshot",
      distanceKm: input.distanceKm,
      runDate: input.runDate,
      evidenceUrl: input.evidenceUrl,
      status: "accepted",
      acceptedAt: nowIso(),
    };
    await this.repository.saveSubmission(submission);
    return submission;
  }

  async syncStravaRuns(input: {
    workspaceId: string;
    month: MonthKey;
    memberId: string;
  }): Promise<RunSubmission[]> {
    const challenge = await this.requireOpenChallenge(input.workspaceId, input.month);
    const member = await this.requireMember(input.memberId, input.workspaceId);
    if (!member.connectedStravaAthleteId) {
      throw new DomainError("Member has not connected a Strava athlete.");
    }
    if (!this.stravaProvider) {
      throw new DomainError("Strava provider is not configured.");
    }

    const activities = (await this.stravaProvider.listActivities(member.connectedStravaAthleteId, input.month)).filter(
      (activity) => isIsoDateInMonth(activity.runDate, input.month),
    );
    return this.importStravaActivities(challenge.id, input.workspaceId, input.memberId, activities);
  }

  async importStravaActivities(
    challengeId: string,
    workspaceId: string,
    memberId: string,
    activities: StravaActivity[],
  ): Promise<RunSubmission[]> {
    const existing = await this.repository.listSubmissionsByChallenge(challengeId);
    const seenExternalIds = new Set(
      existing.filter((submission) => submission.externalActivityId).map((submission) => submission.externalActivityId),
    );

    const created: RunSubmission[] = [];
    for (const activity of activities) {
      if (seenExternalIds.has(activity.activityId)) {
        continue;
      }
      if (!Number.isFinite(activity.distanceKm) || activity.distanceKm <= 0 || !isIsoDate(activity.runDate)) {
        continue;
      }

      const submission: RunSubmission = {
        id: randomUUID(),
        workspaceId,
        challengeId,
        memberId,
        sourceType: "strava_activity",
        distanceKm: activity.distanceKm,
        runDate: activity.runDate,
        externalActivityId: activity.activityId,
        status: "accepted",
        acceptedAt: nowIso(),
      };
      seenExternalIds.add(activity.activityId);
      created.push(submission);
      await this.repository.saveSubmission(submission);
    }

    return created;
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
    memberId: string;
    assignedByMemberId: string;
    note: string;
  }): Promise<PunishmentRecord> {
    const challenge = await this.requireChallenge(input.workspaceId, input.month);
    await this.requireMember(input.memberId, input.workspaceId);
    await this.requireMember(input.assignedByMemberId, input.workspaceId);

    const record: PunishmentRecord = {
      id: randomUUID(),
      workspaceId: input.workspaceId,
      challengeId: challenge.id,
      memberId: input.memberId,
      assignedByMemberId: input.assignedByMemberId,
      note: input.note,
      createdAt: nowIso(),
    };
    await this.repository.savePunishmentRecord(record);
    return record;
  }

  async closeMonth(input: { workspaceId: string; month: MonthKey }): Promise<MonthCloseSummary> {
    const challenge = await this.requireOpenChallenge(input.workspaceId, input.month);
    const members = await this.repository.listMembersByWorkspace(input.workspaceId);
    const goals = await this.repository.listGoalsByChallenge(challenge.id);
    const submissions = await this.repository.listSubmissionsByChallenge(challenge.id);
    const statuses = buildMemberMonthStatuses(members, goals, submissions);
    const closedAt = nowIso();
    const results = [];

    for (const status of statuses) {
      const result = {
        id: randomUUID(),
        ...buildMonthlyResult(status.memberId, closedAt, challenge.id, input.workspaceId, status),
      };
      results.push(result);
      await this.repository.saveMonthlyResult(result);

      if (result.generatedCarryoverKm > 0) {
        const carryover: CarryoverPenalty = {
          id: randomUUID(),
          workspaceId: input.workspaceId,
          memberId: result.memberId,
          sourceChallengeId: challenge.id,
          targetMonth: nextMonth(input.month),
          amountKm: result.generatedCarryoverKm,
          createdAt: closedAt,
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
    const statuses = await this.getMemberStatuses(input.workspaceId, challenge.id);
    return buildLeaderboardRows(statuses);
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
    prompts: ScheduledPrompt[];
  }> {
    const challenge = await this.requireChallenge(input.workspaceId, input.month);
    const [goals, submissions, leaderboard, leader, prompts] = await Promise.all([
      this.repository.listGoalsByChallenge(challenge.id),
      this.repository.listSubmissionsByChallenge(challenge.id),
      this.getLeaderboard(input),
      this.repository.getLeaderAssignmentByChallenge(challenge.id),
      this.repository.listScheduledPromptsByChallenge(challenge.id),
    ]);

    return {
      challenge,
      goals,
      submissions,
      leaderboard,
      leaderId: leader?.memberId,
      prompts,
    };
  }

  private buildDefaultPrompts(challenge: MonthlyChallenge): ScheduledPrompt[] {
    const start = monthStartIso(challenge.month);
    const close = monthCloseIso(challenge.month);
    const prompts: Array<{ kind: PromptKind; offsetDays: number; channelKey: ScheduledPrompt["channelKey"] }> = [
      { kind: "month_start", offsetDays: 0, channelKey: "announcements" },
      { kind: "leaderboard_update", offsetDays: 3, channelKey: "leaderboard" },
      { kind: "weekly_reminder", offsetDays: 7, channelKey: "announcements" },
      { kind: "leaderboard_update", offsetDays: 10, channelKey: "leaderboard" },
      { kind: "weekly_reminder", offsetDays: 14, channelKey: "announcements" },
      { kind: "leaderboard_update", offsetDays: 17, channelKey: "leaderboard" },
      { kind: "weekly_reminder", offsetDays: 21, channelKey: "announcements" },
      { kind: "leaderboard_update", offsetDays: 24, channelKey: "leaderboard" },
    ];

    return [
      ...prompts.map((prompt) => ({
        id: randomUUID(),
        workspaceId: challenge.workspaceId,
        challengeId: challenge.id,
        month: challenge.month,
        kind: prompt.kind,
        scheduledFor: addDays(start, prompt.offsetDays),
        channelKey: prompt.channelKey,
      })),
      {
        id: randomUUID(),
        workspaceId: challenge.workspaceId,
        challengeId: challenge.id,
        month: challenge.month,
        kind: "month_close",
        scheduledFor: close,
        channelKey: "announcements",
      },
    ];
  }

  private async getCarryoverForMember(
    workspaceId: string,
    month: MonthKey,
    memberId: string,
  ): Promise<number> {
    const carryovers = await this.repository.listCarryoversByTargetMonth(workspaceId, month);
    return carryovers
      .filter((carryover) => carryover.memberId === memberId)
      .reduce((total, carryover) => total + carryover.amountKm, 0);
  }

  private async requireWorkspace(workspaceId: string): Promise<DiscordWorkspace> {
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
