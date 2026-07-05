import { equal, match, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatInputCommandInteraction, User } from "discord.js";
import { RunnerChallengeDiscordBot, type DiscordBotConfig } from "../src/adapters/discord/discordBot.js";
import type { MonthKey } from "../src/core/types.js";
import type { OcrProvider } from "../src/ocr/ocrProvider.js";
import { InMemoryChallengeRepository } from "../src/repositories/inMemoryChallengeRepository.js";
import { ChallengeService } from "../src/services/challengeService.js";

class FakeOcrProvider implements OcrProvider {
  async extractText(): Promise<{ text: string }> {
    return { text: "Morning Run\nDistance\n13.78 km\n5 Jul" };
  }
}

interface TestBotInternals {
  handleInteraction(interaction: ChatInputCommandInteraction): Promise<void>;
  handleButtonInteraction(interaction: TestButtonInteraction): Promise<void>;
  currentMonth(): MonthKey;
  currentDate(): string;
}

interface ReplyPayload {
  content?: string;
  components?: unknown[];
  ephemeral?: boolean;
}

interface TestButtonInteraction {
  guildId: string;
  customId: string;
  user: User;
  deferred: boolean;
  replied: boolean;
  reply(payload: ReplyPayload): Promise<void>;
  update(payload: ReplyPayload): Promise<void>;
  followUp(payload: ReplyPayload): Promise<void>;
}

function config(): DiscordBotConfig {
  return {
    token: "test-token",
    clientId: "bot-user",
    guildId: "guild-1",
    workspaceName: "Run Club",
    timezone: "Australia/Sydney",
    channelRefs: {
      rules: "rules",
      announcements: "announcements",
      progressLog: "progress-log",
      leaderboard: "leaderboard",
      chat: "chat",
      combined: "combined",
    },
  };
}

function user(): User {
  return {
    id: "runner-1",
    bot: false,
    username: "runner",
    globalName: "Runner One",
  } as User;
}

function runSubmitInteraction(runner: User) {
  const replies: ReplyPayload[] = [];
  const edits: ReplyPayload[] = [];
  const deferrals: ReplyPayload[] = [];
  const interaction = {
    guildId: "guild-1",
    commandName: "run-submit",
    user: runner,
    deferred: false,
    replied: false,
    memberPermissions: { has: () => false },
    options: {
      getAttachment: () => ({
        url: "https://cdn.example/run.png",
        contentType: "image/png",
      }),
      getNumber: () => null,
      getString: () => null,
      getUser: () => null,
    },
    async deferReply(payload: ReplyPayload) {
      this.deferred = true;
      deferrals.push(payload);
    },
    async editReply(payload: ReplyPayload) {
      edits.push(payload);
    },
    async reply(payload: ReplyPayload) {
      this.replied = true;
      replies.push(payload);
    },
    async followUp(payload: ReplyPayload) {
      replies.push(payload);
    },
  };

  return {
    interaction: interaction as unknown as ChatInputCommandInteraction,
    replies,
    edits,
    deferrals,
  };
}

function buttonInteraction(customId: string, runner: User) {
  const replies: ReplyPayload[] = [];
  const updates: ReplyPayload[] = [];
  const interaction: TestButtonInteraction = {
    guildId: "guild-1",
    customId,
    user: runner,
    deferred: false,
    replied: false,
    async reply(payload: ReplyPayload) {
      this.replied = true;
      replies.push(payload);
    },
    async update(payload: ReplyPayload) {
      updates.push(payload);
    },
    async followUp(payload: ReplyPayload) {
      replies.push(payload);
    },
  };

  return { interaction, replies, updates };
}

function customIds(payload: ReplyPayload): string[] {
  const row = payload.components?.[0] as { components?: Array<{ data?: { custom_id?: string } }> } | undefined;
  return row?.components?.map((component) => component.data?.custom_id).filter((id): id is string => Boolean(id)) ?? [];
}

describe("RunnerChallengeDiscordBot proof confirmation flow", () => {
  it("confirms an OCR-only proof once before recording the run", async () => {
    const repository = new InMemoryChallengeRepository();
    const service = new ChallengeService(repository);
    const bot = new RunnerChallengeDiscordBot(config(), service, repository, new FakeOcrProvider());
    const internals = bot as unknown as TestBotInternals;
    internals.currentMonth = () => "2026-07";
    internals.currentDate = () => "2026-07-05";
    const runner = user();

    const proofSubmission = runSubmitInteraction(runner);
    await internals.handleInteraction(proofSubmission.interaction);

    equal(proofSubmission.deferrals[0]?.ephemeral, true);
    equal(proofSubmission.replies.length, 0);
    const confirmation = proofSubmission.edits[0];
    match(confirmation?.content ?? "", /I read this from your screenshot/);
    match(confirmation?.content ?? "", /Distance: 13\.78km/);
    match(confirmation?.content ?? "", /Date: 2026-07-05/);

    const workspace = await repository.getWorkspaceByGuildId("guild-1");
    ok(workspace);
    const challenge = await repository.getChallengeByMonth(workspace.id, "2026-07");
    ok(challenge);
    equal((await repository.listSubmissionsByChallenge(challenge.id)).length, 0);

    const confirmId = customIds(confirmation).find((id) => id.startsWith("run-proof:confirm:"));
    ok(confirmId);
    const firstConfirm = buttonInteraction(confirmId, runner);
    await internals.handleButtonInteraction(firstConfirm.interaction);

    match(firstConfirm.updates[0]?.content ?? "", /Run logged: 13\.78km on 2026-07-05/);
    equal(firstConfirm.updates[0]?.components?.length, 0);
    const submissions = await repository.listSubmissionsByChallenge(challenge.id);
    equal(submissions.length, 1);
    equal(submissions[0]?.evidenceUrl, "https://cdn.example/run.png");

    const duplicateConfirm = buttonInteraction(confirmId, runner);
    await internals.handleButtonInteraction(duplicateConfirm.interaction);

    equal(duplicateConfirm.replies[0]?.content, "This run confirmation was already handled.");
    equal(duplicateConfirm.replies[0]?.ephemeral, true);
    equal((await repository.listSubmissionsByChallenge(challenge.id)).length, 1);
  });
});
