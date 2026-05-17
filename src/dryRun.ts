import { DiscordCommandHandler } from "./adapters/discord/discordCommandHandler.js";
import { FakeStravaProvider } from "./adapters/strava/stravaProvider.js";
import { createMonthKey } from "./core/time.js";
import type { StravaActivity } from "./core/types.js";
import { InMemoryChallengeRepository } from "./repositories/inMemoryChallengeRepository.js";
import { ChallengeService } from "./services/challengeService.js";

async function main(): Promise<void> {
  const month = createMonthKey(2026, 5);
  const activities = new Map<string, StravaActivity[]>([
    [
      "athlete-brian",
      [
        { activityId: "run-1", athleteId: "athlete-brian", distanceKm: 5.2, runDate: "2026-05-03" },
        { activityId: "run-2", athleteId: "athlete-brian", distanceKm: 7.8, runDate: "2026-05-08" },
      ],
    ],
  ]);
  const repository = new InMemoryChallengeRepository();
  const service = new ChallengeService(repository, new FakeStravaProvider(activities));
  const handler = new DiscordCommandHandler(service, repository);
  const workspace = await service.createWorkspace({
    name: "Runner Challenger Dry Run",
    discordGuildId: "dry-run-guild",
    timezone: "Australia/Sydney",
    channelRefs: {
      rules: "rules",
      announcements: "announcements",
      progressLog: "progress-log",
      leaderboard: "leaderboard",
      chat: "chat",
      combined: "combined",
    },
  });
  const brian = await service.registerMember({
    workspaceId: workspace.id,
    discordUserId: "discord-brian",
    displayName: "Brian",
    connectedStravaAthleteId: "athlete-brian",
  });
  await service.startMonth({ workspaceId: workspace.id, month });

  console.log(
    await handler.handle({
      workspaceId: workspace.id,
      month,
      actorMemberId: brian.id,
      commandName: "goal-set",
      options: { distance_km: 100 },
    }),
  );
  console.log(
    await handler.handle({
      workspaceId: workspace.id,
      month,
      actorMemberId: brian.id,
      commandName: "strava-sync",
    }),
  );
  console.log(
    await handler.handle({
      workspaceId: workspace.id,
      month,
      actorMemberId: brian.id,
      commandName: "leaderboard",
    }),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
