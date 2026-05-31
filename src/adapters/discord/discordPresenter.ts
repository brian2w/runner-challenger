import type {
  GroupProgressSummary,
  LeaderboardRow,
  MemberMonthStatus,
  MonthCloseSummary,
  PunishmentRecord,
  ScheduledPrompt,
} from "../../core/types.js";

function renderProgressBar(percent: number): string {
  const filled = Math.min(Math.round(percent / 10), 10);
  return `[${"#".repeat(filled)}${"-".repeat(10 - filled)}]`;
}

export class DiscordPresenter {
  renderLeaderboard(month: string, leaderboard: LeaderboardRow[], group?: GroupProgressSummary): string {
    const lines = leaderboard.map(
      (row) =>
        `${row.rank}. ${row.displayName}: ${row.completedKm}/${row.effectiveGoalKm}km ${renderProgressBar(
          row.percentComplete,
        )} ${row.percentComplete}%${row.hasGoal ? "" : " (no goal set)"}`,
    );
    const groupLine = group
      ? [
          `**Group:** ${group.completedKm}/${group.effectiveGoalKm}km ${renderProgressBar(group.percentComplete)} ${group.percentComplete}%`,
          `Goals set: ${group.membersWithGoals}/${group.totalMembers} members`,
        ]
      : [];
    return [`**Leaderboard · ${month}**`, ...groupLine, ...lines].join("\n");
  }

  renderMemberStatus(status: MemberMonthStatus): string {
    if (!status.hasGoal) {
      return `${status.displayName}: ${status.completedKm}km logged. No goal set yet.`;
    }

    const percent = status.effectiveGoalKm === 0 ? 0 : Math.round((status.completedKm / status.effectiveGoalKm) * 100);
    return `${status.displayName}: ${status.completedKm}/${status.effectiveGoalKm}km ${renderProgressBar(percent)} ${percent}%`;
  }

  renderMonthStartPrompt(month: string): string {
    return `**New month: ${month}**\nSet your goal with \`/goal-set\`, then log runs with \`/run-submit\` or sync Strava with \`/strava-sync\`.`;
  }

  renderReminder(month: string): string {
    return `**Weekly check-in · ${month}**\nLog your runs, sync Strava, and keep the leaderboard moving.`;
  }

  renderMonthClose(summary: MonthCloseSummary, memberNames: Map<string, string>): string {
    const lines = summary.results.map((result) => {
      const name = memberNames.get(result.memberId) ?? result.memberId;
      if (result.noGoalSet) {
        return `${name}: no goal set`;
      }

      if (result.hitGoal) {
        return `${name}: hit ${result.completedKm}/${result.effectiveGoalKm}km`;
      }

      return `${name}: missed by ${result.missedKm}km, next carryover ${result.generatedCarryoverKm}km`;
    });

    const missedAnyGoal = summary.results.some((result) => !result.noGoalSet && !result.hitGoal);
    const punishmentPrompt = missedAnyGoal
      ? ["Leader: assign punishments with `/leader-record-punishment member note`."]
      : [];

    return [`**Month closed · ${summary.month}**`, ...lines, ...punishmentPrompt].join("\n");
  }

  renderPunishments(
    month: string,
    punishments: PunishmentRecord[],
    memberNames: Map<string, string>,
    assignedByNames: Map<string, string>,
  ): string {
    if (punishments.length === 0) {
      return `**Punishments · ${month}**\nNo punishments recorded.`;
    }

    const lines = punishments.map((punishment, index) => {
      const memberName = memberNames.get(punishment.memberId) ?? punishment.memberId;
      const assignedByName = assignedByNames.get(punishment.assignedByMemberId) ?? punishment.assignedByMemberId;
      return `${index + 1}. ${memberName}: ${punishment.note} (assigned by ${assignedByName})`;
    });
    return [`**Punishments · ${month}**`, ...lines].join("\n");
  }

  renderLeaderHelp(month: string, input: { isLeader: boolean; isAdmin: boolean }): string {
    const access = input.isLeader
      ? "You are the assigned leader for this month."
      : input.isAdmin
        ? "You are an admin. You can record punishments, but only the assigned leader can remove them."
        : "Only the assigned leader or a server admin can record punishments. Only the assigned leader can remove them.";
    return [
      `**Leader commands · ${month}**`,
      access,
      "`/leader-record-punishment member note` - record a punishment as leader or admin.",
      "`/leader-remove-punishment punishment_id` - remove a recorded punishment as assigned leader.",
      "`/punishments member` - view recorded punishments.",
      "`/admin-override-run submission_id action distance_km` - admins can correct or remove run submissions.",
    ].join("\n");
  }

  renderPrompt(prompt: ScheduledPrompt, month: string): string {
    if (prompt.kind === "month_start") {
      return this.renderMonthStartPrompt(month);
    }
    if (prompt.kind === "weekly_reminder") {
      return this.renderReminder(month);
    }
    if (prompt.kind === "month_close") {
      return `**Month-end today · ${month}**\nFinal sync and screenshot submissions close soon.`;
    }

    return `**Leaderboard update scheduled · ${month}**`;
  }
}
