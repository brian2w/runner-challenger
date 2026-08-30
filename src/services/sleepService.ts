import { DomainError } from "../core/errors.js";
import { isIsoDate } from "../core/time.js";
import type {
  Member,
  SleepInsights,
  SleepLeaderboardRow,
  SleepStageInsight,
  SleepSubmission,
} from "../core/types.js";
import type { ChallengeRepository } from "../repositories/challengeRepository.js";
import type { MomentumRuntime } from "../core/runtime.js";
import { systemMomentumRuntime } from "../core/runtime.js";

const MINIMUM_QUALIFYING_NIGHTS = 4;
const MINIMUM_STAGE_BASELINE_NIGHTS = 7;
const MAX_BASELINE_NIGHTS = 21;

type SleepInput = {
  workspaceId: string;
  memberId: string;
  sleepDate: string;
  totalSleepMinutes: number;
  evidenceUrl: string;
  sleepStart?: string;
  sleepEnd?: string;
  deepSleepMinutes?: number;
  lightSleepMinutes?: number;
  remSleepMinutes?: number;
  awakeMinutes?: number;
  latestAllowedDate?: string;
};

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function median(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1]! + ordered[middle]!) / 2 : ordered[middle]!;
}

function circularMedian(values: number[]): number {
  return values.reduce((best, candidate) => {
    const candidateDistance = values.reduce((total, value) => total + circularDifference(candidate, value), 0);
    const bestDistance = values.reduce((total, value) => total + circularDifference(best, value), 0);
    return candidateDistance < bestDistance ? candidate : best;
  });
}

function durationPoints(minutes: number): number {
  const hours = minutes / 60;
  if (hours >= 7 && hours <= 9) {
    return 60;
  }
  if (hours > 4.5 && hours < 7) {
    return 60 * (hours - 4.5) / 2.5;
  }
  if (hours > 9 && hours < 11) {
    return 60 * (11 - hours) / 2;
  }
  return 0;
}

function clockMinutes(time: string): number | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) {
    return undefined;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : undefined;
}

function sleepMidpoint(submission: SleepSubmission): number | undefined {
  if (!submission.sleepStart) {
    return undefined;
  }
  const start = clockMinutes(submission.sleepStart);
  if (start === undefined) {
    return undefined;
  }
  const end = submission.sleepEnd ? clockMinutes(submission.sleepEnd) : undefined;
  const windowMinutes = end === undefined ? submission.totalSleepMinutes : (end - start + 24 * 60) % (24 * 60);
  return (start + windowMinutes / 2) % (24 * 60);
}

function circularDifference(left: number, right: number): number {
  const difference = Math.abs(left - right);
  return Math.min(difference, 24 * 60 - difference);
}

function scoreSleep(submission: SleepSubmission, historical: SleepSubmission[]): number {
  const duration = durationPoints(submission.totalSleepMinutes);
  const midpoint = sleepMidpoint(submission);
  const baselineMidpoints = historical.map(sleepMidpoint).filter((value): value is number => value !== undefined);
  if (midpoint === undefined || baselineMidpoints.length < 3) {
    return round((duration / 60) * 100);
  }
  const usualMidpoint = circularMedian(baselineMidpoints);
  const deviation = circularDifference(midpoint, usualMidpoint);
  const consistency = deviation <= 30 ? 40 : deviation >= 150 ? 0 : 40 * (150 - deviation) / 120;
  return round(duration + consistency);
}

function weekStart(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  const day = (parsed.getUTCDay() + 6) % 7;
  parsed.setUTCDate(parsed.getUTCDate() - day);
  return parsed.toISOString().slice(0, 10);
}

function dateOffset(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function consecutiveStreak(records: SleepSubmission[], asOfDate: string): number {
  const dates = new Set(records.map((record) => record.sleepDate));
  let streak = 0;
  for (let cursor = asOfDate; dates.has(cursor); cursor = dateOffset(cursor, -1)) {
    streak += 1;
  }
  return streak;
}

function stageInsight(
  label: SleepStageInsight["label"],
  latestMinutes: number | undefined,
  baselineMinutes: number[],
): SleepStageInsight | undefined {
  if (latestMinutes === undefined || baselineMinutes.length < MINIMUM_STAGE_BASELINE_NIGHTS) {
    return undefined;
  }
  const usualMinutes = median(baselineMinutes);
  const deviations = baselineMinutes.map((value) => Math.abs(value - usualMinutes));
  const tolerance = Math.max(15, median(deviations) * 2);
  return {
    label,
    latestMinutes,
    usualMinutes: Math.round(usualMinutes),
    regularityScore: Math.round(clamp(100 - (100 * Math.abs(latestMinutes - usualMinutes)) / tolerance, 0, 100)),
  };
}

export class SleepService {
  private readonly submissionLocks = new Map<string, Promise<SleepSubmission>>();
  constructor(
    private readonly repository: ChallengeRepository,
    private readonly runtime: MomentumRuntime = systemMomentumRuntime,
  ) {}

  async submitSleepProof(input: SleepInput): Promise<SleepSubmission> {
    const key = `${input.workspaceId}:${input.memberId}:${input.sleepDate}`;
    const activeSubmission = this.submissionLocks.get(key) ?? Promise.resolve(undefined);
    const submission = activeSubmission
      .catch(() => undefined)
      .then(() => this.submitSleepProofUnlocked(input));
    this.submissionLocks.set(key, submission);
    try {
      return await submission;
    } finally {
      if (this.submissionLocks.get(key) === submission) {
        this.submissionLocks.delete(key);
      }
    }
  }

  private async submitSleepProofUnlocked(input: SleepInput): Promise<SleepSubmission> {
    const { latestAllowedDate, evidenceUrl, ...sleepInput } = input;
    const member = await this.repository.getMemberById(input.memberId);
    if (!member || member.workspaceId !== input.workspaceId || member.isBot) {
      throw new DomainError("Sleep submissions require a participating member.");
    }
    if (!evidenceUrl) {
      throw new DomainError("Sleep submissions require a Garmin screenshot.");
    }
    if (!isIsoDate(input.sleepDate)) {
      throw new DomainError("Sleep date must be a valid date in YYYY-MM-DD format.");
    }
    if (latestAllowedDate && input.sleepDate > latestAllowedDate) {
      throw new DomainError("Sleep date cannot be in the future.");
    }
    if (!Number.isInteger(input.totalSleepMinutes) || input.totalSleepMinutes < 1 || input.totalSleepMinutes > 24 * 60) {
      throw new DomainError("Total sleep must be a whole number of minutes between 1 and 1440.");
    }
    for (const [label, value] of Object.entries({
      deep_sleep_minutes: input.deepSleepMinutes,
      light_sleep_minutes: input.lightSleepMinutes,
      rem_sleep_minutes: input.remSleepMinutes,
      awake_minutes: input.awakeMinutes,
    })) {
      if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 24 * 60)) {
        throw new DomainError(`${label} must be a whole number of minutes between 0 and 1440.`);
      }
    }
    const stageTotal = (input.deepSleepMinutes ?? 0) + (input.lightSleepMinutes ?? 0) + (input.remSleepMinutes ?? 0);
    if (stageTotal > input.totalSleepMinutes + 5) {
      throw new DomainError("Deep, Light, and REM sleep cannot exceed total sleep.");
    }
    for (const [label, value] of Object.entries({ sleep_start: input.sleepStart, sleep_end: input.sleepEnd })) {
      if (value !== undefined && clockMinutes(value) === undefined) {
        throw new DomainError(`${label} must use 24-hour HH:MM format.`);
      }
    }
    if (input.sleepStart && input.sleepEnd) {
      const start = clockMinutes(input.sleepStart)!;
      const end = clockMinutes(input.sleepEnd)!;
      const timeInBedMinutes = (end - start + 24 * 60) % (24 * 60);
      if (timeInBedMinutes === 0 || input.totalSleepMinutes > timeInBedMinutes) {
        throw new DomainError("Total sleep cannot exceed the submitted sleep window.");
      }
      if (input.awakeMinutes !== undefined && Math.abs(input.totalSleepMinutes + input.awakeMinutes - timeInBedMinutes) > 60) {
        throw new DomainError("Sleep window, total sleep, and awake time are materially inconsistent.");
      }
    }

    const existing = await this.repository.getSleepSubmissionByMemberAndDate(
      input.workspaceId,
      input.memberId,
      input.sleepDate,
    );
    const now = this.runtime.now();
    const submission: SleepSubmission = {
      id: existing?.id ?? this.runtime.createId(),
      ...sleepInput,
      proofSubmitted: true,
      acceptedAt: existing?.acceptedAt ?? now,
      updatedAt: now,
    };
    await this.repository.saveSleepSubmission(submission);
    return submission;
  }

  async getLeaderboard(input: { workspaceId: string; asOfDate: string }): Promise<SleepLeaderboardRow[]> {
    if (!isIsoDate(input.asOfDate)) {
      throw new DomainError("Leaderboard date must be a valid date in YYYY-MM-DD format.");
    }
    const [members, records] = await Promise.all([
      this.repository.listMembersByWorkspace(input.workspaceId),
      this.repository.listSleepSubmissionsByWorkspace(input.workspaceId),
    ]);
    const start = weekStart(input.asOfDate);
    const weeklyRecords = records.filter((record) => record.sleepDate >= start && record.sleepDate <= input.asOfDate);
    const rows = members.filter((member) => !member.isBot).map((member) => this.leaderboardRow(member, weeklyRecords, records, input.asOfDate));
    const qualifying = rows.filter((row) => row.qualifies).sort(
      (left, right) => right.averageScore - left.averageScore || right.nightsLogged - left.nightsLogged || right.streak - left.streak || left.displayName.localeCompare(right.displayName),
    );
    const ranks = new Map(qualifying.map((row, index) => [row.memberId, index + 1]));
    return rows.map((row) => ({ ...row, rank: ranks.get(row.memberId) })).sort(
      (left, right) => (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER) || right.nightsLogged - left.nightsLogged || left.displayName.localeCompare(right.displayName),
    );
  }

  async getInsights(input: { workspaceId: string; memberId: string; asOfDate: string }): Promise<SleepInsights> {
    const records = (await this.repository.listSleepSubmissionsByWorkspace(input.workspaceId))
      .filter((record) => record.memberId === input.memberId && record.sleepDate <= input.asOfDate);
    const latest = records.at(-1);
    const baseline = latest ? records.filter((record) => record.sleepDate < latest.sleepDate).slice(-MAX_BASELINE_NIGHTS) : [];
    const start = weekStart(input.asOfDate);
    const weeklyRecords = records.filter((record) => record.sleepDate >= start);
    const scores = weeklyRecords.map((record) => scoreSleep(
      record,
      records.filter((candidate) => candidate.sleepDate < record.sleepDate).slice(-MAX_BASELINE_NIGHTS),
    ));
    const stageInsights = latest ? [
      stageInsight("Deep", latest.deepSleepMinutes, baseline.flatMap((record) => record.deepSleepMinutes === undefined ? [] : [record.deepSleepMinutes])),
      stageInsight("REM", latest.remSleepMinutes, baseline.flatMap((record) => record.remSleepMinutes === undefined ? [] : [record.remSleepMinutes])),
      stageInsight("Awake", latest.awakeMinutes, baseline.flatMap((record) => record.awakeMinutes === undefined ? [] : [record.awakeMinutes])),
    ].filter((insight): insight is SleepStageInsight => insight !== undefined) : [];
    return {
      baselineNights: baseline.length,
      requiredBaselineNights: MINIMUM_STAGE_BASELINE_NIGHTS,
      averageScore: scores.length === 0 ? 0 : round(scores.reduce((total, score) => total + score, 0) / scores.length),
      latest,
      stageInsights,
    };
  }

  private leaderboardRow(
    member: Member,
    weeklyRecords: SleepSubmission[],
    allRecords: SleepSubmission[],
    asOfDate: string,
  ): SleepLeaderboardRow {
    const memberRecords = allRecords.filter((record) => record.memberId === member.id);
    const nightlyScores = weeklyRecords.filter((record) => record.memberId === member.id).map((record) => scoreSleep(
      record,
      memberRecords.filter((candidate) => candidate.sleepDate < record.sleepDate).slice(-MAX_BASELINE_NIGHTS),
    ));
    return {
      memberId: member.id,
      displayName: member.displayName,
      averageScore: nightlyScores.length === 0 ? 0 : round(nightlyScores.reduce((total, score) => total + score, 0) / nightlyScores.length),
      nightsLogged: nightlyScores.length,
      streak: consecutiveStreak(memberRecords, asOfDate),
      qualifies: nightlyScores.length >= MINIMUM_QUALIFYING_NIGHTS,
    };
  }
}
