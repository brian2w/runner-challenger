import { RunnerChallengeDiscordBot, type DiscordBotConfig } from "./adapters/discord/discordBot.js";
import { StravaOAuthServer } from "./adapters/http/stravaOAuthServer.js";
import { StravaOAuthClient } from "./adapters/strava/stravaProvider.js";
import { JsonFileChallengeRepository } from "./repositories/jsonFileChallengeRepository.js";
import { ChallengeService } from "./services/challengeService.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function channelRefs(): DiscordBotConfig["channelRefs"] {
  return {
    rules: process.env.DISCORD_RULES_CHANNEL_ID ?? "rules",
    announcements: process.env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID ?? "announcements",
    progressLog: process.env.DISCORD_PROGRESS_LOG_CHANNEL_ID ?? "progress-log",
    leaderboard: process.env.DISCORD_LEADERBOARD_CHANNEL_ID ?? "leaderboard",
    chat: process.env.DISCORD_CHAT_CHANNEL_ID ?? "chat",
    combined: process.env.DISCORD_COMBINED_CHANNEL_ID ?? "combined",
  };
}

async function main(): Promise<void> {
  const repository = new JsonFileChallengeRepository(process.env.DATA_FILE ?? ".tmp/runner-challenger.json");
  await repository.init();

  const stravaClient =
    process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET && process.env.STRAVA_REDIRECT_URI
      ? new StravaOAuthClient(repository, {
          clientId: process.env.STRAVA_CLIENT_ID,
          clientSecret: process.env.STRAVA_CLIENT_SECRET,
          redirectUri: process.env.STRAVA_REDIRECT_URI,
        })
      : undefined;

  const service = new ChallengeService(repository, stravaClient);
  const stravaStateSecret = process.env.STRAVA_STATE_SECRET ?? requireEnv("DISCORD_TOKEN");
  const bot = new RunnerChallengeDiscordBot(
    {
      token: requireEnv("DISCORD_TOKEN"),
      clientId: requireEnv("DISCORD_CLIENT_ID"),
      guildId: requireEnv("DISCORD_GUILD_ID"),
      workspaceName: process.env.WORKSPACE_NAME ?? "Runner Challenger",
      timezone: process.env.TIMEZONE ?? "Australia/Sydney",
      channelRefs: channelRefs(),
      stravaStateSecret,
    },
    service,
    repository,
    stravaClient,
  );

  if (process.env.REGISTER_COMMANDS !== "false") {
    await bot.registerGuildCommands();
    console.log("Registered Discord slash commands for the configured guild.");
  }

  if (stravaClient) {
    new StravaOAuthServer(repository, stravaClient, Number(process.env.PORT ?? 3000), stravaStateSecret).start();
  } else {
    console.warn("Strava is not configured. /strava-connect will tell users Strava is unavailable.");
  }

  await bot.start();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
