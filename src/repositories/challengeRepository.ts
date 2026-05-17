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

export interface ChallengeRepository {
  saveWorkspace(workspace: DiscordWorkspace): Promise<void>;
  getWorkspaceById(workspaceId: string): Promise<DiscordWorkspace | undefined>;
  getWorkspaceByGuildId(discordGuildId: string): Promise<DiscordWorkspace | undefined>;
  listWorkspaces(): Promise<DiscordWorkspace[]>;

  saveMember(member: Member): Promise<void>;
  getMemberById(memberId: string): Promise<Member | undefined>;
  getMemberByDiscordUserId(workspaceId: string, discordUserId: string): Promise<Member | undefined>;
  listMembersByWorkspace(workspaceId: string): Promise<Member[]>;

  saveChallenge(challenge: MonthlyChallenge): Promise<void>;
  getChallengeByMonth(workspaceId: string, month: string): Promise<MonthlyChallenge | undefined>;

  saveLeaderAssignment(assignment: LeaderAssignment): Promise<void>;
  getLeaderAssignmentByChallenge(challengeId: string): Promise<LeaderAssignment | undefined>;

  saveGoal(goal: MonthlyGoal): Promise<void>;
  getGoal(challengeId: string, memberId: string): Promise<MonthlyGoal | undefined>;
  listGoalsByChallenge(challengeId: string): Promise<MonthlyGoal[]>;

  saveSubmission(submission: RunSubmission): Promise<void>;
  getSubmissionById(submissionId: string): Promise<RunSubmission | undefined>;
  listSubmissionsByChallenge(challengeId: string): Promise<RunSubmission[]>;

  saveCarryoverPenalty(penalty: CarryoverPenalty): Promise<void>;
  listCarryoversByTargetMonth(workspaceId: string, month: string): Promise<CarryoverPenalty[]>;

  saveMonthlyResult(result: MonthlyResult): Promise<void>;
  listMonthlyResultsByChallenge(challengeId: string): Promise<MonthlyResult[]>;

  savePunishmentRecord(record: PunishmentRecord): Promise<void>;
  listPunishmentsByChallenge(challengeId: string): Promise<PunishmentRecord[]>;

  saveScheduledPrompt(prompt: ScheduledPrompt): Promise<void>;
  listScheduledPromptsByChallenge(challengeId: string): Promise<ScheduledPrompt[]>;

  saveStravaConnection(connection: StravaConnection): Promise<void>;
  getStravaConnectionByMemberId(memberId: string): Promise<StravaConnection | undefined>;
}
