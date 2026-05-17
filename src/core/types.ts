export type MonthKey = `${number}-${number}`;

export type ChallengeKind = "monthly_distance_km";
export type ChallengeStatus = "open" | "closed";
export type EvidenceSourceType = "manual_screenshot" | "strava_activity";
export type SubmissionStatus = "accepted" | "corrected" | "removed";
export type PromptKind =
  | "month_start"
  | "weekly_reminder"
  | "leaderboard_update"
  | "month_close";

export interface DiscordWorkspace {
  id: string;
  name: string;
  discordGuildId: string;
  timezone: string;
  channelRefs: {
    rules: string;
    announcements: string;
    progressLog: string;
    leaderboard: string;
    chat: string;
    combined: string;
  };
  createdAt: string;
}

export interface Member {
  id: string;
  workspaceId: string;
  discordUserId: string;
  displayName: string;
  connectedStravaAthleteId?: string;
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
  externalActivityId?: string;
  status: SubmissionStatus;
  note?: string;
  acceptedAt: string;
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
  memberId: string;
  assignedByMemberId: string;
  note: string;
  createdAt: string;
}

export interface ScheduledPrompt {
  id: string;
  workspaceId: string;
  challengeId: string;
  month: MonthKey;
  kind: PromptKind;
  scheduledFor: string;
  channelKey: keyof DiscordWorkspace["channelRefs"];
  deliveredAt?: string;
}

export interface StravaActivity {
  activityId: string;
  athleteId: string;
  distanceKm: number;
  runDate: string;
}

export interface StravaConnection {
  id: string;
  workspaceId: string;
  memberId: string;
  athleteId: string;
  scope: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  updatedAt: string;
}

export interface LeaderboardRow {
  memberId: string;
  displayName: string;
  completedKm: number;
  effectiveGoalKm: number;
  percentComplete: number;
  rank: number;
  hasGoal: boolean;
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
