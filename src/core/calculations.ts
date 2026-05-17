import type {
  LeaderboardRow,
  Member,
  MemberMonthStatus,
  MonthlyGoal,
  MonthlyResult,
  RunSubmission,
} from "./types.js";

function roundKm(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeEffectiveGoal(baseGoalKm: number, carryoverKm: number): number {
  return roundKm(baseGoalKm + carryoverKm);
}

export function computeCarryoverPenalty(missedKm: number): number {
  return roundKm(missedKm * 1.15);
}

export function computeCompletedKm(submissions: RunSubmission[]): number {
  return roundKm(
    submissions
      .filter((submission) => submission.status !== "removed")
      .reduce((total, submission) => total + submission.distanceKm, 0),
  );
}

export function buildMemberMonthStatuses(
  members: Member[],
  goals: MonthlyGoal[],
  submissions: RunSubmission[],
): MemberMonthStatus[] {
  return members.map((member) => {
    const goal = goals.find((candidate) => candidate.memberId === member.id);
    const completedKm = computeCompletedKm(submissions.filter((submission) => submission.memberId === member.id));

    return {
      memberId: member.id,
      displayName: member.displayName,
      completedKm,
      baseGoalKm: goal?.baseGoalKm ?? 0,
      carryoverKm: goal?.carryoverKm ?? 0,
      effectiveGoalKm: goal?.effectiveGoalKm ?? 0,
      hasGoal: Boolean(goal),
    };
  });
}

export function buildLeaderboardRows(statuses: MemberMonthStatus[]): LeaderboardRow[] {
  return [...statuses]
    .sort((left, right) => {
      const rightPercent = right.effectiveGoalKm === 0 ? 0 : right.completedKm / right.effectiveGoalKm;
      const leftPercent = left.effectiveGoalKm === 0 ? 0 : left.completedKm / left.effectiveGoalKm;
      if (rightPercent !== leftPercent) {
        return rightPercent - leftPercent;
      }

      return right.completedKm - left.completedKm;
    })
    .map((status, index) => ({
      memberId: status.memberId,
      displayName: status.displayName,
      completedKm: status.completedKm,
      effectiveGoalKm: status.effectiveGoalKm,
      percentComplete:
        status.effectiveGoalKm === 0 ? 0 : roundKm((status.completedKm / status.effectiveGoalKm) * 100),
      rank: index + 1,
      hasGoal: status.hasGoal,
    }));
}

export function buildMonthlyResult(
  memberId: string,
  closedAt: string,
  challengeId: string,
  workspaceId: string,
  status: MemberMonthStatus,
): Omit<MonthlyResult, "id"> {
  if (!status.hasGoal) {
    return {
      workspaceId,
      challengeId,
      memberId,
      completedKm: status.completedKm,
      baseGoalKm: 0,
      carryoverKm: 0,
      effectiveGoalKm: 0,
      hitGoal: false,
      missedKm: 0,
      generatedCarryoverKm: 0,
      noGoalSet: true,
      closedAt,
    };
  }

  const missedKm = roundKm(Math.max(status.effectiveGoalKm - status.completedKm, 0));
  return {
    workspaceId,
    challengeId,
    memberId,
    completedKm: status.completedKm,
    baseGoalKm: status.baseGoalKm,
    carryoverKm: status.carryoverKm,
    effectiveGoalKm: status.effectiveGoalKm,
    hitGoal: missedKm === 0,
    missedKm,
    generatedCarryoverKm: computeCarryoverPenalty(missedKm),
    noGoalSet: false,
    closedAt,
  };
}
