import { DiscordCommandHandler } from "./adapters/discord/discordCommandHandler.js";
import { createMonthKey } from "./core/time.js";
import { InMemoryChallengeRepository } from "./repositories/inMemoryChallengeRepository.js";
import { ChallengeService } from "./services/challengeService.js";

async function main(): Promise<void> {
  const month = createMonthKey(2026, 5);
  const repository = new InMemoryChallengeRepository();
  const service = new ChallengeService(repository);
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
      commandName: "run-submit",
      options: {
        proof: "https://cdn.example/brian-run-proof.png",
        distance_km: 13,
        run_date: "2026-05-08",
        source: "Garmin screenshot",
      },
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
