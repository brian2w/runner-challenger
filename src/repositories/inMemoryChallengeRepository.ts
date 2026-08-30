import type {
  CarryoverPenalty,
  LeaderAssignment,
  Member,
  MonthlyChallenge,
  MonthlyGoal,
  MonthlyResult,
  PunishmentRecord,
  RunSubmission,
  SleepSubmission,
  NotificationIntent,
  Workspace,
} from "../core/types.js";
import type { MemberIdentity, WorkspaceIntegration } from "../application/platformIdentityRepository.js";
import type { ChallengeRepository } from "./challengeRepository.js";

export class InMemoryChallengeRepository implements ChallengeRepository {
  protected readonly workspaces = new Map<string, Workspace>();
  protected readonly workspaceIntegrations = new Map<string, WorkspaceIntegration>();
  protected readonly members = new Map<string, Member>();
  protected readonly memberIdentities = new Map<string, MemberIdentity>();
  protected readonly challenges = new Map<string, MonthlyChallenge>();
  protected readonly leaderAssignments = new Map<string, LeaderAssignment>();
  protected readonly goals = new Map<string, MonthlyGoal>();
  protected readonly submissions = new Map<string, RunSubmission>();
  protected readonly sleepSubmissions = new Map<string, SleepSubmission>();
  protected readonly carryovers = new Map<string, CarryoverPenalty>();
  protected readonly results = new Map<string, MonthlyResult>();
  protected readonly punishments = new Map<string, PunishmentRecord>();
  protected readonly notificationIntents = new Map<string, NotificationIntent>();

  async saveWorkspace(workspace: Workspace): Promise<void> {
    this.workspaces.set(workspace.id, workspace);
  }

  async getWorkspaceById(workspaceId: string): Promise<Workspace | undefined> {
    return this.workspaces.get(workspaceId);
  }

  async listWorkspaces(): Promise<Workspace[]> {
    return [...this.workspaces.values()];
  }

  async saveMember(member: Member): Promise<void> {
    this.members.set(member.id, member);
  }

  async getMemberById(memberId: string): Promise<Member | undefined> {
    return this.members.get(memberId);
  }

  async listMembersByWorkspace(workspaceId: string): Promise<Member[]> {
    return [...this.members.values()].filter((member) => member.workspaceId === workspaceId);
  }

  async saveChallenge(challenge: MonthlyChallenge): Promise<void> {
    this.challenges.set(challenge.id, challenge);
  }

  async getChallengeByMonth(workspaceId: string, month: string): Promise<MonthlyChallenge | undefined> {
    return [...this.challenges.values()].find(
      (challenge) => challenge.workspaceId === workspaceId && challenge.month === month,
    );
  }

  async saveLeaderAssignment(assignment: LeaderAssignment): Promise<void> {
    for (const existing of this.leaderAssignments.values()) {
      if (existing.challengeId === assignment.challengeId) {
        this.leaderAssignments.delete(existing.id);
      }
    }
    this.leaderAssignments.set(assignment.id, assignment);
  }

  async getLeaderAssignmentByChallenge(challengeId: string): Promise<LeaderAssignment | undefined> {
    return [...this.leaderAssignments.values()].find((assignment) => assignment.challengeId === challengeId);
  }

  async saveGoal(goal: MonthlyGoal): Promise<void> {
    this.goals.set(goal.id, goal);
  }

  async getGoal(challengeId: string, memberId: string): Promise<MonthlyGoal | undefined> {
    return [...this.goals.values()].find(
      (goal) => goal.challengeId === challengeId && goal.memberId === memberId,
    );
  }

  async listGoalsByChallenge(challengeId: string): Promise<MonthlyGoal[]> {
    return [...this.goals.values()].filter((goal) => goal.challengeId === challengeId);
  }

  async saveSubmission(submission: RunSubmission): Promise<void> {
    this.submissions.set(submission.id, submission);
  }

  async getSubmissionById(submissionId: string): Promise<RunSubmission | undefined> {
    return this.submissions.get(submissionId);
  }

  async listSubmissionsByChallenge(challengeId: string): Promise<RunSubmission[]> {
    return [...this.submissions.values()].filter((submission) => submission.challengeId === challengeId);
  }

  async saveSleepSubmission(submission: SleepSubmission): Promise<void> {
    this.sleepSubmissions.set(submission.id, submission);
  }

  async getSleepSubmissionByMemberAndDate(
    workspaceId: string,
    memberId: string,
    sleepDate: string,
  ): Promise<SleepSubmission | undefined> {
    return [...this.sleepSubmissions.values()].find(
      (submission) =>
        submission.workspaceId === workspaceId &&
        submission.memberId === memberId &&
        submission.sleepDate === sleepDate,
    );
  }

  async listSleepSubmissionsByWorkspace(workspaceId: string): Promise<SleepSubmission[]> {
    return [...this.sleepSubmissions.values()]
      .filter((submission) => submission.workspaceId === workspaceId)
      .sort((left, right) => left.sleepDate.localeCompare(right.sleepDate));
  }

  async saveCarryoverPenalty(penalty: CarryoverPenalty): Promise<void> {
    this.carryovers.set(penalty.id, penalty);
  }

  async listCarryoversByTargetMonth(workspaceId: string, month: string): Promise<CarryoverPenalty[]> {
    return [...this.carryovers.values()].filter(
      (penalty) => penalty.workspaceId === workspaceId && penalty.targetMonth === month,
    );
  }

  async saveMonthlyResult(result: MonthlyResult): Promise<void> {
    this.results.set(result.id, result);
  }

  async listMonthlyResultsByChallenge(challengeId: string): Promise<MonthlyResult[]> {
    return [...this.results.values()].filter((result) => result.challengeId === challengeId);
  }

  async savePunishmentRecord(record: PunishmentRecord): Promise<void> {
    this.punishments.set(record.id, record);
  }

  async getPunishmentById(punishmentId: string): Promise<PunishmentRecord | undefined> {
    return this.punishments.get(punishmentId);
  }

  async deletePunishmentRecord(punishmentId: string): Promise<void> {
    this.punishments.delete(punishmentId);
  }

  async listPunishmentsByChallenge(challengeId: string): Promise<PunishmentRecord[]> {
    return [...this.punishments.values()].filter((record) => record.challengeId === challengeId);
  }

  async saveWorkspaceIntegration(integration: WorkspaceIntegration): Promise<void> {
    this.workspaceIntegrations.set(integration.id, integration);
  }

  async getWorkspaceIntegration(platform: string, externalWorkspaceId: string): Promise<WorkspaceIntegration | undefined> {
    return [...this.workspaceIntegrations.values()].find(
      (integration) => integration.platform === platform && integration.externalWorkspaceId === externalWorkspaceId,
    );
  }

  async saveMemberIdentity(identity: MemberIdentity): Promise<void> {
    this.memberIdentities.set(identity.id, identity);
  }

  async getMemberIdentity(
    workspaceId: string,
    platform: string,
    externalUserId: string,
  ): Promise<MemberIdentity | undefined> {
    return [...this.memberIdentities.values()].find(
      (identity) =>
        identity.workspaceId === workspaceId &&
        identity.platform === platform &&
        identity.externalUserId === externalUserId,
    );
  }

  async listMemberIdentities(memberId: string): Promise<MemberIdentity[]> {
    return [...this.memberIdentities.values()].filter((identity) => identity.memberId === memberId);
  }

  async saveNotificationIntent(intent: NotificationIntent): Promise<void> {
    this.notificationIntents.set(intent.id, intent);
  }

  async listNotificationIntentsByChallenge(challengeId: string): Promise<NotificationIntent[]> {
    return [...this.notificationIntents.values()]
      .filter((intent) => intent.challengeId === challengeId)
      .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor));
  }

  async saveScheduledPrompt(intent: NotificationIntent): Promise<void> {
    await this.saveNotificationIntent(intent);
  }

  async listScheduledPromptsByChallenge(challengeId: string): Promise<NotificationIntent[]> {
    return this.listNotificationIntentsByChallenge(challengeId);
  }
}
