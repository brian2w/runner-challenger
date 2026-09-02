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

class SleepOcrProvider implements OcrProvider {
  async extractText(): Promise<{ text: string }> {
    return { text: "Today\n8h 21m\nTotal Sleep\n2h 47m 4h 43m\nDeep Light\n51m 1m\nREM Awake\nSleep Timeline\n11:03 pm 7:25 am" };
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
  embeds?: Array<{ thumbnail?: { url?: string } }>;
  files?: Array<{ attachment?: Buffer; name?: string }>;
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
  };
}

function user(avatarUrl = "https://cdn.example/avatars/runner.png"): User {
  return {
    id: "runner-1",
    bot: false,
    username: "runner",
    globalName: "Runner One",
    displayAvatarURL: () => avatarUrl,
  } as User;
}

function statusInteraction(runner: User) {
  const replies: ReplyPayload[] = [];
  const edits: ReplyPayload[] = [];
  const interaction = {
    guildId: "guild-1",
    commandName: "status",
    user: runner,
    deferred: false,
    replied: false,
    memberPermissions: { has: () => false },
    options: {
      getAttachment: () => null,
      getNumber: () => null,
      getString: () => null,
      getUser: () => null,
    },
    async deferReply() {
      this.deferred = true;
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
  };
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

function sleepSubmitInteraction(runner: User) {
  const replies: ReplyPayload[] = [];
  const edits: ReplyPayload[] = [];
  const deferrals: ReplyPayload[] = [];
  const interaction = {
    guildId: "guild-1", commandName: "sleep-submit", user: runner, deferred: false, replied: false,
    memberPermissions: { has: () => false },
    options: {
      getAttachment: () => ({ url: "https://cdn.example/sleep.png", contentType: "image/png" }),
      getNumber: () => null, getInteger: () => null, getString: () => null, getUser: () => null,
    },
    async deferReply(payload: ReplyPayload) { this.deferred = true; deferrals.push(payload); },
    async editReply(payload: ReplyPayload) { edits.push(payload); },
    async reply(payload: ReplyPayload) { this.replied = true; replies.push(payload); },
    async followUp(payload: ReplyPayload) { replies.push(payload); },
  };
  return { interaction: interaction as unknown as ChatInputCommandInteraction, replies, edits, deferrals };
}

function buttonInteraction(customId: string, runner: User) {
  const replies: ReplyPayload[] = [];
  const updates: ReplyPayload[] = [];
  const followUps: ReplyPayload[] = [];
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
      followUps.push(payload);
    },
  };

  return { interaction, replies, updates, followUps };
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

    const workspace = await service.getWorkspaceByIntegration("discord", "guild-1");
    ok(workspace);
    const identity = await repository.getMemberIdentity(workspace.id, "discord", runner.id);
    const member = identity ? await repository.getMemberById(identity.memberId) : undefined;
    equal(member?.profileImageUrl, "https://cdn.example/avatars/runner.png");
    equal(member?.profileImageSource, "platform_avatar");
    const challenge = await repository.getChallengeByMonth(workspace.id, "2026-07");
    ok(challenge);
    equal((await repository.listSubmissionsByChallenge(challenge.id)).length, 0);

    const confirmId = customIds(confirmation).find((id) => id.startsWith("run-proof:confirm:"));
    ok(confirmId);
    const firstConfirm = buttonInteraction(confirmId, runner);
    await internals.handleButtonInteraction(firstConfirm.interaction);

    match(firstConfirm.updates[0]?.content ?? "", /Run logged. Posted to the channel./);
    equal(firstConfirm.updates[0]?.components?.length, 0);
    equal(firstConfirm.updates[0]?.files, undefined);
    match(firstConfirm.followUps[0]?.content ?? "", /Run logged: 13\.78km on 2026-07-05/);
    equal(firstConfirm.followUps[0]?.ephemeral, undefined);
    equal(firstConfirm.followUps[0]?.files?.[0]?.name?.startsWith("run-summary-"), true);
    ok(firstConfirm.followUps[0]?.files?.[0]?.attachment instanceof Buffer);
    const submissions = await repository.listSubmissionsByChallenge(challenge.id);
    equal(submissions.length, 1);
    equal(submissions[0]?.evidenceUrl, "https://cdn.example/run.png");

    const duplicateConfirm = buttonInteraction(confirmId, runner);
    await internals.handleButtonInteraction(duplicateConfirm.interaction);

    equal(duplicateConfirm.replies[0]?.content, "This run confirmation was already handled.");
    equal(duplicateConfirm.replies[0]?.ephemeral, true);
    equal((await repository.listSubmissionsByChallenge(challenge.id)).length, 1);
  });

  it("confirms OCR sleep and saves recognized stages", async () => {
    const repository = new InMemoryChallengeRepository();
    const service = new ChallengeService(repository);
    const bot = new RunnerChallengeDiscordBot(config(), service, repository, new SleepOcrProvider());
    const internals = bot as unknown as TestBotInternals;
    internals.currentMonth = () => "2026-09";
    internals.currentDate = () => "2026-09-02";
    const runner = user();
    const submission = sleepSubmitInteraction(runner);

    await internals.handleInteraction(submission.interaction);
    const confirmation = submission.edits[0];
    match(confirmation?.content ?? "", /Total sleep: 8h 21m/);
    match(confirmation?.content ?? "", /Deep: 2h 47m/);
    match(confirmation?.content ?? "", /Light: 4h 43m/);
    match(confirmation?.content ?? "", /REM: 0h 51m/);
    match(confirmation?.content ?? "", /Awake: 0h 1m/);

    const confirmId = customIds(confirmation).find((id) => id.startsWith("sleep-proof:confirm:"));
    ok(confirmId);
    const confirmed = buttonInteraction(confirmId, runner);
    await internals.handleButtonInteraction(confirmed.interaction);
    match(confirmed.updates[0]?.content ?? "", /Sleep logged/);
    match(confirmed.followUps[0]?.content ?? "", /\*\*Sleep logged\*\*/);
    match(confirmed.followUps[0]?.content ?? "", /Deep 2h 47m/);
  });

  it("shows the saved profile image on status replies", async () => {
    const repository = new InMemoryChallengeRepository();
    const service = new ChallengeService(repository);
    const bot = new RunnerChallengeDiscordBot(config(), service, repository);
    const internals = bot as unknown as TestBotInternals;
    internals.currentMonth = () => "2026-07";
    internals.currentDate = () => "2026-07-05";
    const runner = user("https://cdn.example/avatars/status.png");

    const status = statusInteraction(runner);
    await internals.handleInteraction(status.interaction);

    match(status.replies[0]?.content ?? "", /Runner One: 0km logged/);
    equal(status.replies[0]?.embeds?.[0]?.thumbnail?.url, "https://cdn.example/avatars/status.png");
  });
});
