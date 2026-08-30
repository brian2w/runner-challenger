export type MonthKey = `${number}-${number}`;

export type ChallengeKind = "monthly_distance_km";
export type ChallengeStatus = "open" | "closed";
export type EvidenceSourceType = "proof_attachment";
export type SubmissionStatus = "accepted" | "corrected" | "removed";
export type ProfileImageSource = "platform_avatar" | "custom_url";
export type PromptKind =
  | "month_start"
  | "weekly_reminder"
  | "leaderboard_update"
  | "month_close";

export interface Workspace {
  id: string;
  name: string;
  timezone: string;
  createdAt: string;
}

export interface Member {
  id: string;
  workspaceId: string;
  displayName: string;
  profileImageUrl?: string;
  profileImageSource?: ProfileImageSource;
  isBot?: boolean;
  createdAt: string;
}

export interface MonthlyChallenge {
  id: string;
  workspaceId: string;
  month: MonthKey;
  kind: ChallengeKind;
  status: ChallengeStatus;
  createdAt: string;
  closedAt?: string;
}

export interface LeaderAssignment {
  id: string;
  workspaceId: string;
  challengeId: string;
  memberId: string;
  assignedAt: string;
}

export interface MonthlyGoal {
  id: string;
  workspaceId: string;
  challengeId: string;
  memberId: string;
  baseGoalKm: number;
  carryoverKm: number;
  effectiveGoalKm: number;
  createdAt: string;
  updatedAt: string;
}

export interface RunSubmission {
  id: string;
  workspaceId: string;
  challengeId: string;
  memberId: string;
  sourceType: EvidenceSourceType;
  distanceKm: number;
  runDate: string;
  evidenceUrl?: string;
  evidenceLabel?: string;
  status: SubmissionStatus;
  note?: string;
  userNote?: string;
  acceptedAt: string;
}

export interface SleepSubmission {
  id: string;
  workspaceId: string;
  memberId: string;
  sleepDate: string;
  totalSleepMinutes: number;
  sleepStart?: string;
  sleepEnd?: string;
  deepSleepMinutes?: number;
  lightSleepMinutes?: number;
  remSleepMinutes?: number;
  awakeMinutes?: number;
  proofSubmitted: boolean;
  acceptedAt: string;
  updatedAt: string;
}

export interface SleepLeaderboardRow {
  memberId: string;
  displayName: string;
  averageScore: number;
  nightsLogged: number;
  streak: number;
  qualifies: boolean;
  rank?: number;
}

export interface SleepStageInsight {
  label: "Deep" | "REM" | "Awake";
  latestMinutes: number;
  usualMinutes: number;
  regularityScore: number;
}

export interface SleepInsights {
  baselineNights: number;
  requiredBaselineNights: number;
  averageScore: number;
  latest?: SleepSubmission;
  stageInsights: SleepStageInsight[];
}

export interface CarryoverPenalty {
  id: string;
  workspaceId: string;
  memberId: string;
  sourceChallengeId: string;
  targetMonth: MonthKey;
  amountKm: number;
  createdAt: string;
}

export interface MonthlyResult {
  id: string;
  workspaceId: string;
  challengeId: string;
  memberId: string;
  completedKm: number;
  baseGoalKm: number;
  carryoverKm: number;
  effectiveGoalKm: number;
  hitGoal: boolean;
  missedKm: number;
  generatedCarryoverKm: number;
  noGoalSet: boolean;
  closedAt: string;
}

export interface PunishmentRecord {
  id: string;
  workspaceId: string;
  challengeId: string;
  assignedByMemberId: string;
  note: string;
  createdAt: string;
}

export type NotificationAudience = "workspace" | "leader";

export interface NotificationIntent {
  id: string;
  workspaceId: string;
  challengeId: string;
  month: MonthKey;
  kind: PromptKind;
  scheduledFor: string;
  audience: NotificationAudience;
  deliveredAt?: string;
}

export interface LeaderboardRow {
  memberId: string;
  displayName: string;
  completedKm: number;
  effectiveGoalKm: number;
  percentComplete: number;
  rank: number;
  hasGoal: boolean;
  isLeader?: boolean;
}

export interface GroupProgressSummary {
  completedKm: number;
  effectiveGoalKm: number;
  percentComplete: number;
  membersWithGoals: number;
  totalMembers: number;
}

export interface MemberMonthStatus {
  memberId: string;
  displayName: string;
  completedKm: number;
  baseGoalKm: number;
  carryoverKm: number;
  effectiveGoalKm: number;
  hasGoal: boolean;
}

export interface MonthCloseSummary {
  workspaceId: string;
  challengeId: string;
  month: MonthKey;
  leaderId?: string;
  results: MonthlyResult[];
}
