import { equal, match, rejects } from "node:assert/strict";
import { describe, it } from "node:test";
import { DiscordCommandHandler } from "../src/adapters/discord/discordCommandHandler.js";
import { InMemoryChallengeRepository } from "../src/repositories/inMemoryChallengeRepository.js";
import { ChallengeService } from "../src/services/challengeService.js";
import { SleepService } from "../src/services/sleepService.js";

async function fixture() {
  const repository = new InMemoryChallengeRepository();
  await repository.saveWorkspace({ id: "workspace-1", name: "Sleep Club", timezone: "Pacific/Auckland", createdAt: "2026-08-01T00:00:00.000Z" });
  await repository.saveMember({ id: "member-a", workspaceId: "workspace-1", displayName: "Alex", createdAt: "2026-08-01T00:00:00.000Z" });
  await repository.saveMember({ id: "member-b", workspaceId: "workspace-1", displayName: "Blair", createdAt: "2026-08-01T00:00:00.000Z" });
  return { service: new SleepService(repository), repository };
}

async function submit(
  service: SleepService,
  memberId: string,
  sleepDate: string,
  totalSleepMinutes = 480,
  extras: Partial<{ sleepStart: string; sleepEnd: string; deepSleepMinutes: number; lightSleepMinutes: number; remSleepMinutes: number; awakeMinutes: number }> = {},
) {
  return service.submitSleepProof({
    workspaceId: "workspace-1",
    memberId,
    sleepDate,
    totalSleepMinutes,
    evidenceUrl: `https://cdn.example/${memberId}-${sleepDate}.png`,
    sleepStart: "23:00",
    sleepEnd: "07:00",
    ...extras,
  });
}

describe("SleepService", () => {
  it("upserts one proof-backed sleep record per member and wake date", async () => {
    const { service, repository } = await fixture();
    const first = await submit(service, "member-a", "2026-08-31", 466, { deepSleepMinutes: 200, lightSleepMinutes: 247, remSleepMinutes: 19, awakeMinutes: 1 });
    const replacement = await submit(service, "member-a", "2026-08-31", 480);

    equal(replacement.id, first.id);
    equal(replacement.totalSleepMinutes, 480);
    equal(replacement.proofSubmitted, true);
    equal("evidenceUrl" in replacement, false);
    equal((await repository.listSleepSubmissionsByWorkspace("workspace-1")).length, 1);
  });

  it("validates proof, future dates, times, and incompatible stage totals", async () => {
    const { service } = await fixture();
    await rejects(() => service.submitSleepProof({ workspaceId: "workspace-1", memberId: "member-a", sleepDate: "2026-09-01", totalSleepMinutes: 480, evidenceUrl: "", latestAllowedDate: "2026-08-31" }), /require a Garmin screenshot/);
    await rejects(() => service.submitSleepProof({ workspaceId: "workspace-1", memberId: "member-a", sleepDate: "2026-09-01", totalSleepMinutes: 480, evidenceUrl: "https://cdn.example/proof.png", latestAllowedDate: "2026-08-31" }), /cannot be in the future/);
    await rejects(() => submit(service, "member-a", "2026-08-31", 480, { sleepStart: "25:00" }), /HH:MM/);
    await rejects(() => submit(service, "member-a", "2026-08-31", 480, { deepSleepMinutes: 300, lightSleepMinutes: 200, remSleepMinutes: 100 }), /cannot exceed total sleep/);
  });

  it("qualifies at four nights and ranks public scores without stage data", async () => {
    const { service } = await fixture();
    await submit(service, "member-a", "2026-08-23", 270);
    for (const day of ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27"]) {
      await submit(service, "member-a", day, 480);
      await submit(service, "member-b", day, 390);
    }

    const leaderboard = await service.getLeaderboard({ workspaceId: "workspace-1", asOfDate: "2026-08-27" });
    equal(leaderboard[0]?.memberId, "member-a");
    equal(leaderboard[0]?.rank, 1);
    equal(leaderboard[0]?.qualifies, true);
    equal(leaderboard[0]?.averageScore, 100);
    equal(leaderboard[1]?.qualifies, true);
    equal(leaderboard[1]?.averageScore, 82);
    const insights = await service.getInsights({ workspaceId: "workspace-1", memberId: "member-a", asOfDate: "2026-08-27" });
    equal(insights.averageScore, leaderboard[0]?.averageScore);
  });

  it("uses a midnight-safe baseline and the submitted sleep window midpoint", async () => {
    const { service } = await fixture();
    for (const [day, start, end] of [
      ["2026-08-24", "19:50", "03:50"],
      ["2026-08-25", "20:00", "04:00"],
      ["2026-08-26", "20:10", "04:10"],
      ["2026-08-27", "19:55", "03:55"],
    ]) {
      await submit(service, "member-a", day, 480, { sleepStart: start, sleepEnd: end });
    }
    const leaderboard = await service.getLeaderboard({ workspaceId: "workspace-1", asOfDate: "2026-08-27" });
    equal(leaderboard[0]?.averageScore, 100);
  });

  it("serializes concurrent submissions for the same member and date", async () => {
    const { service, repository } = await fixture();
    const [first, second] = await Promise.all([
      submit(service, "member-a", "2026-08-31", 466),
      submit(service, "member-a", "2026-08-31", 480),
    ]);
    equal(first.id, second.id);
    equal((await repository.listSleepSubmissionsByWorkspace("workspace-1")).length, 1);
    equal((await repository.listSleepSubmissionsByWorkspace("workspace-1"))[0]?.totalSleepMinutes, 480);
  });

  it("unlocks private stage insights after seven earlier stage records", async () => {
    const { service } = await fixture();
    for (const day of ["2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23", "2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27"]) {
      await submit(service, "member-a", day, 480, { deepSleepMinutes: 120, lightSleepMinutes: 280, remSleepMinutes: 80, awakeMinutes: 10 });
    }
    const insights = await service.getInsights({ workspaceId: "workspace-1", memberId: "member-a", asOfDate: "2026-08-27" });
    equal(insights.baselineNights, 7);
    equal(insights.stageInsights.length, 3);
    match(String(insights.stageInsights[0]?.label), /Deep/);
  });

  it("keeps stage data out of public Discord command responses", async () => {
    const { service, repository } = await fixture();
    const handler = new DiscordCommandHandler(new ChallengeService(repository), repository, service);
    const response = await handler.handleDetailed({
      workspaceId: "workspace-1",
      month: "2026-08",
      currentDate: "2026-08-31",
      actorMemberId: "member-a",
      commandName: "sleep-submit",
      options: {
        proof: "https://cdn.example/sleep.png",
        total_sleep_minutes: 466,
        sleep_date: "2026-08-31",
        deep_sleep_minutes: 200,
        light_sleep_minutes: 247,
        rem_sleep_minutes: 19,
        awake_minutes: 1,
      },
    });
    match(response.content, /Sleep logged: 7h 46m/);
    equal(response.content.includes("Deep"), false);
  });

  it("combines a typed sleep value with an OCR suggestion", async () => {
    const { service, repository } = await fixture();
    const handler = new DiscordCommandHandler(new ChallengeService(repository), repository, service);
    const response = await handler.handleDetailed({
      workspaceId: "workspace-1",
      month: "2026-08",
      currentDate: "2026-08-31",
      actorMemberId: "member-a",
      commandName: "sleep-submit",
      options: {
        proof: "https://cdn.example/sleep.png",
        total_sleep_minutes: 466,
        ocr_sleep_date: "2026-08-31",
      },
    });
    match(response.content, /I read 7h 46m for 2026-08-31/);
    equal((await repository.listSleepSubmissionsByWorkspace("workspace-1")).length, 0);
  });
});
