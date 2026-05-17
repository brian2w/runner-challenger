import { DomainError } from "../../core/errors.js";
import { parseMonthInput } from "../../core/time.js";
import type { MonthKey } from "../../core/types.js";
import type { ChallengeRepository } from "../../repositories/challengeRepository.js";
import type { ChallengeService } from "../../services/challengeService.js";
import { DiscordPresenter } from "./discordPresenter.js";

export interface DiscordCommandInput {
  workspaceId: string;
  month: MonthKey;
  actorMemberId: string;
  isAdmin?: boolean;
  commandName: string;
  options?: Record<string, string | number | undefined>;
}

export class DiscordCommandHandler {
  constructor(
    private readonly service: ChallengeService,
    private readonly repository: ChallengeRepository,
    private readonly presenter = new DiscordPresenter(),
  ) {}

  async handle(input: DiscordCommandInput): Promise<string> {
    try {
      switch (input.commandName) {
        case "goal-set": {
          const goal = await this.service.setGoal({
            workspaceId: input.workspaceId,
            month: input.month,
            memberId: input.actorMemberId,
            baseGoalKm: this.requireNumber(input.options, "distance_km"),
          });
          return `Goal set: ${goal.baseGoalKm}km base + ${goal.carryoverKm}km carryover = ${goal.effectiveGoalKm}km effective target.`;
        }
        case "run-submit": {
          const submission = await this.service.submitManualRun({
            workspaceId: input.workspaceId,
            month: input.month,
            memberId: input.actorMemberId,
            distanceKm: this.requireNumber(input.options, "distance_km"),
            runDate: this.requireString(input.options, "run_date"),
            evidenceUrl: this.requireString(input.options, "screenshot"),
          });
          return `Run accepted: ${submission.distanceKm}km logged for ${submission.runDate}.`;
        }
        case "leaderboard": {
          const leaderboard = await this.service.getLeaderboard({
            workspaceId: input.workspaceId,
            month: input.month,
          });
          return this.presenter.renderLeaderboard(input.month, leaderboard);
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
          return this.presenter.renderMemberStatus(status);
        }
        case "strava-connect":
          return "Use /strava-connect in the live Discord bot to receive your private Strava OAuth link.";
        case "strava-sync": {
          const imported = await this.service.syncStravaRuns({
            workspaceId: input.workspaceId,
            month: input.month,
            memberId: input.actorMemberId,
          });
          return imported.length === 0
            ? "No new Strava runs were found."
            : `Imported ${imported.length} Strava run${imported.length === 1 ? "" : "s"}.`;
        }
        case "admin-start-month":
          this.requireAdmin(input);
          {
            const month = this.requireMonth(input.options, "month");
            await this.service.startMonth({
              workspaceId: input.workspaceId,
              month,
            });
            return `Month ${month} is ready. ${this.presenter.renderMonthStartPrompt(month)}`;
          }
        case "admin-close-month": {
          this.requireAdmin(input);
          const month = this.requireMonth(input.options, "month");
          const closeSummary = await this.service.closeMonth({
            workspaceId: input.workspaceId,
            month,
          });
          const members = await this.repository.listMembersByWorkspace(input.workspaceId);
          return this.presenter.renderMonthClose(
            closeSummary,
            new Map(members.map((member) => [member.id, member.displayName])),
          );
        }
        case "admin-assign-leader": {
          this.requireAdmin(input);
          const assignment = await this.service.assignLeader({
            workspaceId: input.workspaceId,
            month: input.month,
            memberId: this.requireString(input.options, "member_id"),
          });
          const member = await this.repository.getMemberById(assignment.memberId);
          return `Leader assigned for ${input.month}: ${member?.displayName ?? assignment.memberId}`;
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
          return `Submission ${updated.id} updated to ${updated.distanceKm}km with status ${updated.status}.`;
        }
        case "admin-record-punishment": {
          this.requireAdmin(input);
          const record = await this.service.recordPunishment({
            workspaceId: input.workspaceId,
            month: input.month,
            memberId: this.requireString(input.options, "member_id"),
            assignedByMemberId: input.actorMemberId,
            note: this.requireString(input.options, "note"),
          });
          const member = await this.repository.getMemberById(record.memberId);
          return `Punishment recorded for ${member?.displayName ?? record.memberId}.`;
        }
        default:
          throw new DomainError(`Unknown command: ${input.commandName}`);
      }
    } catch (error) {
      if (error instanceof DomainError) {
        return `Error: ${error.message}`;
      }
      throw error;
    }
  }

  private requireAdmin(input: DiscordCommandInput): void {
    if (!input.isAdmin) {
      throw new DomainError("This command requires admin permissions.");
    }
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

  private requireNumber(options: Record<string, string | number | undefined> | undefined, key: string): number {
    const value = options?.[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new DomainError(`Missing required numeric option: ${key}`);
    }
    return value;
  }

  private optionalNumber(options: Record<string, string | number | undefined> | undefined, key: string): number | undefined {
    const value = options?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }
}
