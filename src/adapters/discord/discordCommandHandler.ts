import { DomainError } from "../../core/errors.js";
import { parseMonthInput } from "../../core/time.js";
import type { MonthKey } from "../../core/types.js";
import type { RunSummaryCardInput } from "../../cards/runSummaryCard.js";
import type { ChallengeRepository } from "../../repositories/challengeRepository.js";
import type { ChallengeService } from "../../services/challengeService.js";
import type { SleepService } from "../../services/sleepService.js";
import { DiscordPresenter } from "./discordPresenter.js";

function formatMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export interface DiscordCommandInput {
  workspaceId: string;
  month: MonthKey;
  actorMemberId: string;
  isAdmin?: boolean;
  currentDate?: string;
  commandName: string;
  options?: Record<string, string | number | undefined>;
}

export interface DiscordCommandResponse {
  content: string;
  runSummaryCard?: RunSummaryCardInput;
}

export class DiscordCommandHandler {
  constructor(
    private readonly service: ChallengeService,
    private readonly repository: ChallengeRepository,
    private readonly sleepService?: SleepService,
    private readonly presenter = new DiscordPresenter(),
  ) {}

  async handle(input: DiscordCommandInput): Promise<string> {
    return (await this.handleDetailed(input)).content;
  }

  async handleDetailed(input: DiscordCommandInput): Promise<DiscordCommandResponse> {
    try {
      switch (input.commandName) {
        case "goal-set": {
          const goal = await this.service.setGoal({
            workspaceId: input.workspaceId,
            month: input.month,
            memberId: input.actorMemberId,
            baseGoalKm: this.requireNumber(input.options, "distance_km"),
          });
          return {
            content: `Goal set: ${goal.baseGoalKm}km base + ${goal.carryoverKm}km carryover = ${goal.effectiveGoalKm}km effective target.`,
          };
        }
        case "run-submit": {
          const distanceKm = this.optionalNumber(input.options, "distance_km");
          const runDate = this.optionalString(input.options, "run_date");
          if (distanceKm === undefined || !runDate) {
            const ocrDistanceKm = this.optionalNumber(input.options, "ocr_distance_km");
            const ocrRunDate = this.optionalString(input.options, "ocr_run_date");
            if (ocrDistanceKm !== undefined && ocrRunDate) {
              return {
                content: `I read ${ocrDistanceKm}km on ${ocrRunDate}. Rerun /run-submit with distance_km:${ocrDistanceKm} run_date:${ocrRunDate}, or type the correct values if OCR misread it.`,
              };
            }
            throw new DomainError(
              "Add distance_km and run_date, or upload a clearer proof screenshot so OCR can read them.",
            );
          }
          const submission = await this.service.submitRunProof({
            workspaceId: input.workspaceId,
            month: input.month,
            memberId: input.actorMemberId,
            distanceKm,
            runDate,
            evidenceUrl: this.requireString(input.options, "proof"),
            evidenceLabel: this.optionalString(input.options, "source"),
            userNote: this.optionalString(input.options, "note"),
          });
          return this.renderRunReceipt(input.workspaceId, submission);
        }
        case "sleep-submit": {
          const sleepService = this.requireSleepService();
          const submission = await sleepService.submitSleepProof({
            workspaceId: input.workspaceId,
            memberId: input.actorMemberId,
            evidenceUrl: this.requireString(input.options, "proof"),
            sleepDate: this.requireString(input.options, "sleep_date"),
            totalSleepMinutes: this.requirePositiveInteger(input.options, "total_sleep_minutes"),
            sleepStart: this.optionalString(input.options, "sleep_start"),
            sleepEnd: this.optionalString(input.options, "sleep_end"),
            deepSleepMinutes: this.optionalNonNegativeInteger(input.options, "deep_sleep_minutes"),
            lightSleepMinutes: this.optionalNonNegativeInteger(input.options, "light_sleep_minutes"),
            remSleepMinutes: this.optionalNonNegativeInteger(input.options, "rem_sleep_minutes"),
            awakeMinutes: this.optionalNonNegativeInteger(input.options, "awake_minutes"),
            latestAllowedDate: this.currentDate(input),
          });
          return { content: `Sleep logged: ${formatMinutes(submission.totalSleepMinutes)} for ${submission.sleepDate}. Use \`/sleep-insights\` for your private stage comparison.` };
        }
        case "sleep-leaderboard": {
          const rows = await this.requireSleepService().getLeaderboard({
            workspaceId: input.workspaceId,
            asOfDate: this.currentDate(input),
          });
          return { content: this.presenter.renderSleepLeaderboard(rows) };
        }
        case "sleep-status": {
          const rows = await this.requireSleepService().getLeaderboard({
            workspaceId: input.workspaceId,
            asOfDate: this.currentDate(input),
          });
          const row = rows.find((candidate) => candidate.memberId === input.actorMemberId);
          if (!row) {
            throw new DomainError("Sleep status was not found.");
          }
          return { content: this.presenter.renderSleepStatus(row) };
        }
        case "sleep-insights": {
          const insights = await this.requireSleepService().getInsights({
            workspaceId: input.workspaceId,
            memberId: input.actorMemberId,
            asOfDate: this.currentDate(input),
          });
          return { content: this.presenter.renderSleepInsights(insights) };
        }
        case "profile-set": {
          await this.service.setMemberProfileImage({
            workspaceId: input.workspaceId,
            memberId: input.actorMemberId,
            imageUrl: this.requireString(input.options, "image_url"),
          });
          return { content: "Profile image updated." };
        }
        case "leaderboard": {
          const request = {
            workspaceId: input.workspaceId,
            month: input.month,
          };
          const [leaderboard, group] = await Promise.all([
            this.service.getLeaderboard(request),
            this.service.getGroupProgress(request),
          ]);
          return { content: this.presenter.renderLeaderboard(input.month, leaderboard, group) };
        }
        case "status": {
          const summary = await this.service.getMonthlySummary({
            workspaceId: input.workspaceId,
            month: input.month,
          });
          const statuses = await this.service.getMemberStatuses(input.workspaceId, summary.challenge.id);
          const status = statuses.find((candidate) => candidate.memberId === input.actorMemberId);
          if (!status) {
            throw new DomainError("Member status was not found.");
          }
          return { content: this.presenter.renderMemberStatus(status) };
        }
        case "punishments": {
          const punishments = await this.service.listPunishments({
            workspaceId: input.workspaceId,
            month: input.month,
          });
          return { content: this.presenter.renderPunishments(input.month, punishments) };
        }
        case "leader-help": {
          const isLeader = await this.isLeader(input);
          return { content: this.presenter.renderLeaderHelp(input.month, { isLeader, isAdmin: Boolean(input.isAdmin) }) };
        }
        case "admin-start-month":
          this.requireAdmin(input);
          {
            const month = this.requireMonth(input.options, "month");
            await this.service.startMonth({
              workspaceId: input.workspaceId,
              month,
            });
            return { content: `Month ${month} is ready. ${this.presenter.renderMonthStartPrompt(month)}` };
          }
        case "admin-close-month": {
          this.requireAdmin(input);
          const month = this.requireMonth(input.options, "month");
          const closeSummary = await this.service.closeMonth({
            workspaceId: input.workspaceId,
            month,
          });
          const members = await this.repository.listMembersByWorkspace(input.workspaceId);
          return {
            content: this.presenter.renderMonthClose(
              closeSummary,
              new Map(members.map((member) => [member.id, member.displayName])),
            ),
          };
        }
        case "admin-assign-leader": {
          this.requireAdmin(input);
          const assignment = await this.service.assignLeader({
            workspaceId: input.workspaceId,
            month: input.month,
            memberId: this.requireString(input.options, "member_id"),
          });
          const member = await this.repository.getMemberById(assignment.memberId);
          return { content: `Leader assigned for ${input.month}: ${member?.displayName ?? assignment.memberId}` };
        }
        case "admin-override-run": {
          this.requireAdmin(input);
          const action = this.requireOverrideAction(input.options);
          const updated = await this.service.overrideRun({
            workspaceId: input.workspaceId,
            month: input.month,
            submissionId: this.requireString(input.options, "submission_id"),
            action,
            distanceKm: this.optionalNumber(input.options, "distance_km"),
            note: "Adjusted via admin override command.",
          });
          return { content: `Submission ${updated.id} updated to ${updated.distanceKm}km with status ${updated.status}.` };
        }
        case "leader-record-punishment": {
          await this.requireLeaderOrAdmin(input);
          const record = await this.service.recordPunishment({
            workspaceId: input.workspaceId,
            month: input.month,
            assignedByMemberId: input.actorMemberId,
            note: this.requireString(input.options, "note"),
          });
          return { content: `Group punishment recorded: ${record.note}` };
        }
        case "leader-remove-punishment": {
          await this.requireLeader(input);
          const punishmentNumber = this.requirePositiveInteger(input.options, "punishment_number");
          const punishments = await this.service.listPunishments({
            workspaceId: input.workspaceId,
            month: input.month,
          });
          const punishment = punishments[punishmentNumber - 1];
          if (!punishment) {
            throw new DomainError("Punishment number was not found for that month.");
          }
          await this.service.removePunishment({
            workspaceId: input.workspaceId,
            month: input.month,
            punishmentId: punishment.id,
          });
          return { content: `Group punishment removed: ${punishment.note}` };
        }
        case "admin-record-punishment": {
          await this.requireLeaderOrAdmin(input);
          const record = await this.service.recordPunishment({
            workspaceId: input.workspaceId,
            month: input.month,
            assignedByMemberId: input.actorMemberId,
            note: this.requireString(input.options, "note"),
          });
          return { content: `Group punishment recorded: ${record.note}` };
        }
        default:
          throw new DomainError(`Unknown command: ${input.commandName}`);
      }
    } catch (error) {
      if (error instanceof DomainError) {
        return { content: `Error: ${error.message}` };
      }
      throw error;
    }
  }

  private requireAdmin(input: DiscordCommandInput): void {
    if (!input.isAdmin) {
      throw new DomainError("This command requires admin permissions.");
    }
  }

  private async requireLeaderOrAdmin(input: DiscordCommandInput): Promise<void> {
    if (await this.isLeaderOrAdmin(input)) {
      return;
    }
    throw new DomainError("This command requires the assigned leader or an admin.");
  }

  private async requireLeader(input: DiscordCommandInput): Promise<void> {
    if (await this.isLeader(input)) {
      return;
    }
    throw new DomainError("This command requires the assigned leader.");
  }

  private async isLeaderOrAdmin(input: DiscordCommandInput): Promise<boolean> {
    if (input.isAdmin) {
      return true;
    }
    return this.isLeader(input);
  }

  private async isLeader(input: DiscordCommandInput): Promise<boolean> {
    const summary = await this.service.getMonthlySummary({
      workspaceId: input.workspaceId,
      month: input.month,
    });
    return summary.leaderId === input.actorMemberId;
  }

  private requireMonth(options: Record<string, string | number | undefined> | undefined, key: string): MonthKey {
    try {
      return parseMonthInput(this.requireString(options, key));
    } catch {
      throw new DomainError(`Invalid month option: ${key}. Use YYYY-MM.`);
    }
  }

  private requireOverrideAction(
    options: Record<string, string | number | undefined> | undefined,
  ): "remove" | "replace_distance" {
    const action = this.requireString(options, "action");
    if (action !== "remove" && action !== "replace_distance") {
      throw new DomainError("Override action must be remove or replace_distance.");
    }
    return action;
  }

  private requireString(options: Record<string, string | number | undefined> | undefined, key: string): string {
    const value = options?.[key];
    if (typeof value !== "string" || value.length === 0) {
      throw new DomainError(`Missing required option: ${key}`);
    }
    return value;
  }

  private optionalString(options: Record<string, string | number | undefined> | undefined, key: string): string | undefined {
    const value = options?.[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  private async renderRunReceipt(workspaceId: string, submission: {
    id: string;
    challengeId: string;
    memberId: string;
    distanceKm: number;
    runDate: string;
    evidenceLabel?: string;
  }): Promise<DiscordCommandResponse> {
    const [statuses, group, member] = await Promise.all([
      this.service.getMemberStatuses(workspaceId, submission.challengeId),
      this.service.getGroupProgress({
        workspaceId,
        month: submission.runDate.slice(0, 7) as MonthKey,
      }),
      this.repository.getMemberById(submission.memberId),
    ]);
    const status = statuses.find((candidate) => candidate.memberId === submission.memberId);
    const proofLabel = submission.evidenceLabel ? `\nProof: ${submission.evidenceLabel}` : "";
    const progress = status
      ? `\nProgress: ${status.completedKm}/${status.effectiveGoalKm}km`
      : "";

    return {
      content: `Run logged: ${submission.distanceKm}km on ${submission.runDate}${proofLabel}${progress}`,
      runSummaryCard: {
        submissionId: submission.id,
        runDate: submission.runDate,
        distanceKm: submission.distanceKm,
        remainingPersonalKm: status ? status.effectiveGoalKm - status.completedKm : 0,
        remainingGroupKm: group.effectiveGoalKm - group.completedKm,
        submitterName: member?.displayName ?? status?.displayName ?? "Runner",
        profileImageUrl: member?.profileImageUrl,
      },
    };
  }

  private requireNumber(options: Record<string, string | number | undefined> | undefined, key: string): number {
    const value = options?.[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new DomainError(`Missing required numeric option: ${key}`);
    }
    return value;
  }

  private requirePositiveInteger(options: Record<string, string | number | undefined> | undefined, key: string): number {
    const value = this.requireNumber(options, key);
    if (!Number.isInteger(value) || value < 1) {
      throw new DomainError(`${key} must be a positive whole number.`);
    }
    return value;
  }

  private optionalNumber(options: Record<string, string | number | undefined> | undefined, key: string): number | undefined {
    const value = options?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }

  private optionalNonNegativeInteger(
    options: Record<string, string | number | undefined> | undefined,
    key: string,
  ): number | undefined {
    const value = this.optionalNumber(options, key);
    if (value === undefined) {
      return undefined;
    }
    if (!Number.isInteger(value) || value < 0) {
      throw new DomainError(`${key} must be a non-negative whole number.`);
    }
    return value;
  }

  private requireSleepService(): SleepService {
    if (!this.sleepService) {
      throw new DomainError("Sleep challenges are not configured.");
    }
    return this.sleepService;
  }

  private currentDate(input: DiscordCommandInput): string {
    return input.currentDate ?? new Date().toISOString().slice(0, 10);
  }
}
