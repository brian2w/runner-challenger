import type {
  GroupProgressSummary,
  LeaderboardRow,
  MemberMonthStatus,
  MonthCloseSummary,
  PunishmentRecord,
  NotificationIntent,
} from "../../core/types.js";

function renderProgressBar(percent: number): string {
  const ticks = Math.max(0, Math.round(percent / 10));
  if (ticks < 10) {
    const winds = Math.max(0, ticks - 1);
    const shoe = ticks > 0 ? "👟" : "";
    return `[${"💨".repeat(winds)}${shoe}${"▫️".repeat(10 - ticks)}]`;
  }
  if (ticks < 20) {
    const demons = ticks - 10;
    return `[${"😈".repeat(demons)}${"✅".repeat(10 - demons)}]`;
  }
  if (ticks < 30) {
    const phoenixes = ticks - 20;
    return `[${"🐦‍🔥".repeat(phoenixes)}${"😈".repeat(10 - phoenixes)}]`;
  }
  const goats = Math.min(ticks - 30, 10);
  return `[${"🐐".repeat(goats)}${"🐦‍🔥".repeat(10 - goats)}]`;
}

function renderMonthName(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

export class DiscordPresenter {
  renderLeaderboard(month: string, leaderboard: LeaderboardRow[], group?: GroupProgressSummary): string {
    const lines = leaderboard.map(
      (row) => {
        const leaderMarker = row.isLeader ? " 👑" : "";
        return `**#${row.rank} · ${row.displayName}${leaderMarker}**\n${row.completedKm}/${row.effectiveGoalKm}km · ${row.percentComplete}%${row.hasGoal ? "" : " (no goal set)"}\n${renderProgressBar(row.percentComplete)}`;
      },
    );
    const groupSection = group
      ? `**Group**\n${group.completedKm}/${group.effectiveGoalKm}km · ${group.percentComplete}%\n${renderProgressBar(group.percentComplete)}\nGoals set: ${group.membersWithGoals}/${group.totalMembers} members`
      : undefined;
    return [`**Leaderboard · ${month}**`, groupSection, "**Runners**", ...lines].filter(Boolean).join("\n\n");
  }

  renderMemberStatus(status: MemberMonthStatus): string {
    if (!status.hasGoal) {
      return `${status.displayName}: ${status.completedKm}km logged. No goal set yet.`;
    }

    const percent = status.effectiveGoalKm === 0 ? 0 : Math.round((status.completedKm / status.effectiveGoalKm) * 100);
    return `${status.displayName}: ${status.completedKm}/${status.effectiveGoalKm}km ${renderProgressBar(percent)} ${percent}%`;
  }

  renderMonthStartPrompt(month: string): string {
    return `**New month: ${month}**\nSet your goal with \`/goal-set\`, then log runs with \`/run-submit\` and attach proof.`;
  }

  renderReminder(month: string): string {
    return `**Weekly check-in · ${month}**\nLog your runs with proof and keep the leaderboard moving.`;
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
      ? ["Leader: record a group punishment with `/leader-record-punishment note`."]
      : [];

    return [`**Month closed · ${summary.month}**`, ...lines, ...punishmentPrompt].join("\n");
  }

  renderPunishments(
    month: string,
    punishments: PunishmentRecord[],
  ): string {
    const monthName = renderMonthName(month);
    if (punishments.length === 0) {
      return `**Punishments · ${monthName}**\nNo punishments recorded.`;
    }

    const lines = punishments.map((punishment, index) => {
      return `  😈 **#${index + 1}** ${punishment.note}`;
    });
    return [`**Punishments · ${monthName}**`, ...lines].join("\n\n");
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
      "`/leader-record-punishment note` - record a group punishment as leader or admin.",
      "`/leader-remove-punishment punishment_number` - remove a numbered punishment as assigned leader.",
      "`/punishments` - view recorded group punishments.",
      "`/admin-override-run submission_id action distance_km` - admins can correct or remove run submissions.",
    ].join("\n");
  }

  renderPrompt(prompt: NotificationIntent, month: string): string {
    if (prompt.kind === "month_start") {
      return this.renderMonthStartPrompt(month);
    }
    if (prompt.kind === "weekly_reminder") {
      return this.renderReminder(month);
    }
    if (prompt.kind === "month_close") {
      return `**Month-end today · ${month}**\nFinal proof submissions close soon.`;
    }

    return `**Leaderboard update scheduled · ${month}**`;
  }
}
