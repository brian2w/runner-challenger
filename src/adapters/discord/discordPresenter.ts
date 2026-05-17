import type { LeaderboardRow, MemberMonthStatus, MonthCloseSummary, ScheduledPrompt } from "../../core/types.js";

function renderProgressBar(percent: number): string {
  const filled = Math.min(Math.round(percent / 10), 10);
  return `[${"#".repeat(filled)}${"-".repeat(10 - filled)}]`;
}

export class DiscordPresenter {
  renderLeaderboard(month: string, leaderboard: LeaderboardRow[]): string {
    const lines = leaderboard.map(
      (row) =>
        `${row.rank}. ${row.displayName}: ${row.completedKm}/${row.effectiveGoalKm}km ${renderProgressBar(
          row.percentComplete,
        )} ${row.percentComplete}%${row.hasGoal ? "" : " (no goal set)"}`,
    );
    return [`**Leaderboard · ${month}**`, ...lines].join("\n");
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

    return [`**Month closed · ${summary.month}**`, ...lines].join("\n");
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
