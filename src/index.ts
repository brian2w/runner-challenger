import { RunnerChallengeDiscordBot } from "./adapters/discord/discordBot.js";
import { loadLocalEnv } from "./config/loadEnv.js";
import { createOcrProvider } from "./ocr/createOcrProvider.js";
import { JsonFileChallengeRepository } from "./repositories/jsonFileChallengeRepository.js";
import { ChallengeService } from "./services/challengeService.js";

loadLocalEnv();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const repository = new JsonFileChallengeRepository(process.env.DATA_FILE ?? ".tmp/runner-challenger.json");
  await repository.init();

  const service = new ChallengeService(repository);
  const ocrProvider = createOcrProvider({
    provider: process.env.OCR_PROVIDER,
    tesseractBinary: process.env.TESSERACT_BINARY,
    tesseractLanguage: process.env.TESSERACT_LANGUAGE,
  });
  const bot = new RunnerChallengeDiscordBot(
    {
      token: requireEnv("DISCORD_TOKEN"),
      clientId: requireEnv("DISCORD_CLIENT_ID"),
      guildId: requireEnv("DISCORD_GUILD_ID"),
      workspaceName: process.env.WORKSPACE_NAME ?? "Runner Challenger",
      timezone: process.env.TIMEZONE ?? "Australia/Sydney",
    },
    service,
    repository,
    ocrProvider,
  );

  if (process.env.REGISTER_COMMANDS !== "false") {
    await bot.registerGuildCommands();
    console.log("Registered Discord slash commands for the configured guild.");
  }

  await bot.start();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
