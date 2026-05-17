import type {
  CarryoverPenalty,
  DiscordWorkspace,
  LeaderAssignment,
  Member,
  MonthlyChallenge,
  MonthlyGoal,
  MonthlyResult,
  PunishmentRecord,
  RunSubmission,
  ScheduledPrompt,
  StravaConnection,
} from "../core/types.js";
import type { ChallengeRepository } from "./challengeRepository.js";

export class InMemoryChallengeRepository implements ChallengeRepository {
  protected readonly workspaces = new Map<string, DiscordWorkspace>();
  protected readonly members = new Map<string, Member>();
  protected readonly challenges = new Map<string, MonthlyChallenge>();
  protected readonly leaderAssignments = new Map<string, LeaderAssignment>();
  protected readonly goals = new Map<string, MonthlyGoal>();
  protected readonly submissions = new Map<string, RunSubmission>();
  protected readonly carryovers = new Map<string, CarryoverPenalty>();
  protected readonly results = new Map<string, MonthlyResult>();
  protected readonly punishments = new Map<string, PunishmentRecord>();
  protected readonly prompts = new Map<string, ScheduledPrompt>();
  protected readonly stravaConnections = new Map<string, StravaConnection>();

  async saveWorkspace(workspace: DiscordWorkspace): Promise<void> {
    this.workspaces.set(workspace.id, workspace);
  }

  async getWorkspaceById(workspaceId: string): Promise<DiscordWorkspace | undefined> {
    return this.workspaces.get(workspaceId);
  }

  async getWorkspaceByGuildId(discordGuildId: string): Promise<DiscordWorkspace | undefined> {
    return [...this.workspaces.values()].find((workspace) => workspace.discordGuildId === discordGuildId);
  }

  async listWorkspaces(): Promise<DiscordWorkspace[]> {
    return [...this.workspaces.values()];
  }

  async saveMember(member: Member): Promise<void> {
    this.members.set(member.id, member);
  }

  async getMemberById(memberId: string): Promise<Member | undefined> {
    return this.members.get(memberId);
  }

  async getMemberByDiscordUserId(workspaceId: string, discordUserId: string): Promise<Member | undefined> {
    return [...this.members.values()].find(
      (member) => member.workspaceId === workspaceId && member.discordUserId === discordUserId,
    );
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

  async listPunishmentsByChallenge(challengeId: string): Promise<PunishmentRecord[]> {
    return [...this.punishments.values()].filter((record) => record.challengeId === challengeId);
  }

  async saveScheduledPrompt(prompt: ScheduledPrompt): Promise<void> {
    this.prompts.set(prompt.id, prompt);
  }

  async listScheduledPromptsByChallenge(challengeId: string): Promise<ScheduledPrompt[]> {
    return [...this.prompts.values()]
      .filter((prompt) => prompt.challengeId === challengeId)
      .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor));
  }

  async saveStravaConnection(connection: StravaConnection): Promise<void> {
    this.stravaConnections.set(connection.memberId, connection);
  }

  async getStravaConnectionByMemberId(memberId: string): Promise<StravaConnection | undefined> {
    return this.stravaConnections.get(memberId);
  }
}
