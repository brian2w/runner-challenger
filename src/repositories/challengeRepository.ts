import type {
  CarryoverPenalty,
  LeaderAssignment,
  Member,
  MonthlyChallenge,
  MonthlyGoal,
  MonthlyResult,
  PunishmentRecord,
  RunSubmission,
  NotificationIntent,
  Workspace,
} from "../core/types.js";
import type { PlatformIdentityRepository } from "../application/platformIdentityRepository.js";

export interface ChallengeRepository extends PlatformIdentityRepository {
  saveWorkspace(workspace: Workspace): Promise<void>;
  getWorkspaceById(workspaceId: string): Promise<Workspace | undefined>;
  listWorkspaces(): Promise<Workspace[]>;

  saveMember(member: Member): Promise<void>;
  getMemberById(memberId: string): Promise<Member | undefined>;
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
  getPunishmentById(punishmentId: string): Promise<PunishmentRecord | undefined>;
  deletePunishmentRecord(punishmentId: string): Promise<void>;
  listPunishmentsByChallenge(challengeId: string): Promise<PunishmentRecord[]>;

  saveNotificationIntent(intent: NotificationIntent): Promise<void>;
  listNotificationIntentsByChallenge(challengeId: string): Promise<NotificationIntent[]>;
}
