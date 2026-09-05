import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
  type User,
} from "discord.js";
import { DomainError } from "../../core/errors.js";
import { createMonthKeyForDate } from "../../core/time.js";
import type { Member, MonthKey, Workspace } from "../../core/types.js";
import { renderRunSummaryCard } from "../../cards/runSummaryCard.js";
import type { OcrProvider } from "../../ocr/ocrProvider.js";
import type { ChallengeRepository } from "../../repositories/challengeRepository.js";
import type { ChallengeService } from "../../services/challengeService.js";
import { SleepService } from "../../services/sleepService.js";
import { slashCommands, SLEEP_PROOF_OPTION_NAMES, type SlashCommandDefinition, type SlashCommandOption } from "./commandCatalog.js";
import { DiscordCommandHandler, type DiscordCommandResponse } from "./discordCommandHandler.js";
import { PendingProofStore, type PendingProof } from "./pendingRunProofStore.js";
import { buildRunProofConfirmationDraft, type RunProofConfirmationDraftInput } from "./runProofConfirmation.js";
import { resolveRunSubmitOptions } from "./runSubmitOptions.js";
import { resolveSleepSubmitOptions } from "./sleepSubmitOptions.js";

interface PendingRunProof extends PendingProof, RunProofConfirmationDraftInput {}

interface PendingSleepProof extends PendingProof {
  month: MonthKey;
  proofUrl: string;
  totalSleepMinutes: number;
  sleepDate: string;
  sleepStart?: string;
  sleepEnd?: string;
  deepSleepMinutes?: number;
  lightSleepMinutes?: number;
  remSleepMinutes?: number;
  awakeMinutes?: number;
}

function formatMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function optionString(options: Record<string, string | number | undefined>, key: string): string | undefined {
  const value = options[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionNumber(options: Record<string, string | number | undefined>, key: string): number | undefined {
  const value = options[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function requireOptionString(options: Record<string, string | number | undefined>, key: string): string {
  const value = optionString(options, key);
  if (!value) throw new DomainError(`Missing required option: ${key}`);
  return value;
}

export interface DiscordBotConfig {
  token: string;
  clientId: string;
  guildId: string;
  workspaceName: string;
  timezone: string;
}

export class RunnerChallengeDiscordBot {
  private readonly client = new Client({ intents: [GatewayIntentBits.Guilds] });
  private readonly handler: DiscordCommandHandler;
  private readonly pendingRunProofs = new PendingProofStore<PendingRunProof>();
  private readonly pendingSleepProofs = new PendingProofStore<PendingSleepProof>();

  constructor(
    private readonly config: DiscordBotConfig,
    private readonly service: ChallengeService,
    private readonly repository: ChallengeRepository,
    private readonly ocrProvider?: OcrProvider,
  ) {
    this.handler = new DiscordCommandHandler(service, repository, new SleepService(repository));
  }

  async registerGuildCommands(): Promise<void> {
    const rest = new REST({ version: "10" }).setToken(this.config.token);
    await rest.put(Routes.applicationGuildCommands(this.config.clientId, this.config.guildId), {
      body: slashCommands.map((command) => this.toDiscordCommand(command)),
    });
  }

  async start(): Promise<void> {
    await this.bootstrapWorkspace();
    this.client.once(Events.ClientReady, (readyClient) => {
      console.log(`Runner Challenger logged in as ${readyClient.user.tag}`);
    });
    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (interaction.isChatInputCommand()) {
        await this.handleInteraction(interaction);
        return;
      }
      if (interaction.isButton()) {
        await this.handleButtonInteraction(interaction);
      }
    });
    await this.client.login(this.config.token);
  }

  async bootstrapWorkspace(): Promise<Workspace> {
    const workspace = await this.service.getOrCreateWorkspaceForIntegration({
      name: this.config.workspaceName,
      timezone: this.config.timezone,
      platform: "discord",
      externalWorkspaceId: this.config.guildId,
    });

    await this.service.startMonth({
      workspaceId: workspace.id,
      month: this.currentMonth(),
    });
    await this.service.registerMember({
      workspaceId: workspace.id,
      platform: "discord",
      externalUserId: this.config.clientId,
      displayName: this.config.workspaceName,
      isBot: true,
    });
    return workspace;
  }

  private async handleInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
    try {
      if (!interaction.guildId) {
        await interaction.reply({ content: "Use this bot inside a Discord server.", ephemeral: true });
        return;
      }
      if (interaction.user.bot) {
        await interaction.reply({ content: "Bot accounts cannot participate in challenges.", ephemeral: true });
        return;
      }

      const workspace = await this.bootstrapWorkspace();
      const actor = await this.ensureMember(workspace, interaction.user);
      const month = this.currentMonth();
      const shouldUseOcr = this.shouldUseOcr(interaction);
      if (shouldUseOcr) {
        await interaction.deferReply({ ephemeral: true });
      }

      const options = await this.commandOptions(interaction, workspace, month);
      if (await this.replyWithRunProofConfirmation(interaction, workspace, actor, month, options)) {
        return;
      }
      if (await this.replyWithSleepProofConfirmation(interaction, workspace, actor, month, options)) {
        return;
      }

      const response = await this.handler.handleDetailed({
        workspaceId: workspace.id,
        month,
        actorMemberId: actor.id,
        isAdmin: this.isAdmin(interaction),
        currentDate: this.currentDate(),
        commandName: interaction.commandName,
        options,
      });

      await this.sendInteractionResponse(
        interaction,
        response.content,
        await this.responseExtras(interaction.commandName, actor, response),
        interaction.commandName === "sleep-insights",
      );
    } catch (error) {
      const content = error instanceof Error ? `Error: ${error.message}` : "Error: unexpected failure.";
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content, ephemeral: true });
      } else {
        await interaction.reply({ content, ephemeral: true });
      }
    }
  }

  private async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    try {
      if (!interaction.guildId) {
        await interaction.reply({ content: "Use this bot inside a Discord server.", ephemeral: true });
        return;
      }

      const sleepAction = this.parseSleepProofAction(interaction.customId);
      if (sleepAction) {
        await this.handleSleepProofAction(interaction, sleepAction.draftId, sleepAction.kind);
        return;
      }
      const action = this.parseRunProofAction(interaction.customId);
      if (!action) {
        return;
      }

      const workspace = await this.bootstrapWorkspace();
      const actor = await this.ensureMember(workspace, interaction.user);
      const claim = this.pendingRunProofs.claim(
        action.draftId,
        (draft) => draft.workspaceId === workspace.id && draft.actorMemberId === actor.id,
      );
      if (claim.status === "handled") {
        await interaction.reply({ content: "This run confirmation was already handled.", ephemeral: true });
        return;
      }
      if (claim.status === "missing") {
        await interaction.update({
          content: "This run confirmation expired. Upload the screenshot again.",
          components: [],
        });
        return;
      }
      if (claim.status === "forbidden") {
        await interaction.reply({ content: "This run confirmation belongs to another member.", ephemeral: true });
        return;
      }
      const draft = claim.draft;

      if (action.kind === "cancel") {
        await interaction.update({ content: "Run submission cancelled.", components: [] });
        return;
      }

      try {
        const response = await this.handler.handleDetailed({
          workspaceId: draft.workspaceId,
          month: draft.month,
          actorMemberId: draft.actorMemberId,
          commandName: "run-submit",
          options: {
            proof: draft.proofUrl,
            distance_km: draft.distanceKm,
            run_date: draft.runDate,
            source: draft.source,
            note: draft.note,
          },
        });
        if (response.content.startsWith("Error:")) {
          await interaction.update({ content: response.content, components: [] });
          return;
        }

        await interaction.update({ content: "Run logged. Posted to the channel.", components: [] });
        await interaction.followUp({
          content: response.content,
          ...(await this.responseExtras("run-submit", actor, response)),
        });
      } catch (error) {
        const content = error instanceof Error ? `Error: ${error.message}` : "Error: unexpected failure.";
        await interaction.update({ content, components: [] });
      }
    } catch (error) {
      const content = error instanceof Error ? `Error: ${error.message}` : "Error: unexpected failure.";
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content, ephemeral: true });
      } else {
        await interaction.reply({ content, ephemeral: true });
      }
    }
  }

  private async commandOptions(
    interaction: ChatInputCommandInteraction,
    workspace: Workspace,
    month: MonthKey,
  ): Promise<Record<string, string | number | undefined>> {
    switch (interaction.commandName) {
      case "goal-set":
        return { distance_km: interaction.options.getNumber("distance_km", true) };
      case "run-submit":
        return this.runSubmitOptions(interaction, month);
      case "sleep-submit":
        return this.sleepSubmitOptions(interaction);
      case "profile-set":
        return { image_url: interaction.options.getString("image_url", true) };
      case "admin-start-month":
      case "admin-close-month":
        return { month: interaction.options.getString("month", true) };
      case "admin-assign-leader": {
        const user = interaction.options.getUser("member", true);
        const member = await this.ensureMember(workspace, user);
        return { member_id: member.id };
      }
      case "punishments":
      case "sleep-leaderboard":
      case "sleep-status":
      case "sleep-insights":
        return {};
      case "admin-override-run":
        return {
          submission_id: interaction.options.getString("submission_id", true),
          action: interaction.options.getString("action", true),
          distance_km: interaction.options.getNumber("distance_km") ?? undefined,
        };
      case "leader-record-punishment":
        return { note: interaction.options.getString("note", true) };
      case "leader-remove-punishment":
        return { punishment_number: interaction.options.getInteger("punishment_number", true) };
      case "admin-record-punishment":
        return { note: interaction.options.getString("note", true) };
      default:
        return {};
    }
  }

  private async runSubmitOptions(
    interaction: ChatInputCommandInteraction,
    month: MonthKey,
  ): Promise<Record<string, string | number | undefined>> {
    const proof = interaction.options.getAttachment("proof", true);
    if (proof.contentType && !proof.contentType.startsWith("image/")) {
      throw new DomainError("Proof must be an image screenshot.");
    }
    const distanceKm = interaction.options.getNumber("distance_km") ?? undefined;
    const runDate = interaction.options.getString("run_date") ?? undefined;
    const source = interaction.options.getString("source") ?? undefined;
    const note = interaction.options.getString("note") ?? undefined;

    return resolveRunSubmitOptions(
      {
        proofUrl: proof.url,
        month,
        distanceKm,
        runDate,
        source,
        note,
        fallbackDate: this.currentDate(),
      },
      this.ocrProvider,
    );
  }

  private async sleepSubmitOptions(interaction: ChatInputCommandInteraction): Promise<Record<string, string | number | undefined>> {
    const proofUrls = SLEEP_PROOF_OPTION_NAMES.flatMap((name) => {
      const proof = interaction.options.getAttachment(name, name === "proof");
      if (!proof) return [];
      if (proof.contentType && !proof.contentType.startsWith("image/")) {
        throw new DomainError("Proof must be an image screenshot.");
      }
      return [proof.url];
    });
    const options = await resolveSleepSubmitOptions({
      proofUrls,
      totalSleepMinutes: interaction.options.getInteger("total_sleep_minutes") ?? undefined,
      sleepDate: interaction.options.getString("sleep_date") ?? undefined,
      sleepStart: interaction.options.getString("sleep_start") ?? undefined,
      sleepEnd: interaction.options.getString("sleep_end") ?? undefined,
      deepSleepMinutes: interaction.options.getInteger("deep_sleep_minutes") ?? undefined,
      lightSleepMinutes: interaction.options.getInteger("light_sleep_minutes") ?? undefined,
      remSleepMinutes: interaction.options.getInteger("rem_sleep_minutes") ?? undefined,
      awakeMinutes: interaction.options.getInteger("awake_minutes") ?? undefined,
      fallbackDate: this.currentDate(),
    }, this.ocrProvider);
    const conflict = optionString(options, "ocr_conflict");
    if (conflict) {
      throw new DomainError(`Supporting screenshots disagree about ${conflict}. Rerun with typed values for the disputed fields.`);
    }
    return options;
  }

  private shouldUseOcr(interaction: ChatInputCommandInteraction): boolean {
    return (
      (interaction.commandName === "run-submit" || interaction.commandName === "sleep-submit") &&
      Boolean(this.ocrProvider) &&
      (interaction.commandName === "run-submit"
        ? interaction.options.getNumber("distance_km") === null || interaction.options.getString("run_date") === null
        : interaction.options.getInteger("total_sleep_minutes") === null || interaction.options.getString("sleep_date") === null ||
          SLEEP_PROOF_OPTION_NAMES.slice(1).some((name) => interaction.options.getAttachment(name) !== null))
    );
  }

  private async replyWithRunProofConfirmation(
    interaction: ChatInputCommandInteraction,
    workspace: Workspace,
    actor: Member,
    month: MonthKey,
    options: Record<string, string | number | undefined>,
  ): Promise<boolean> {
    if (interaction.commandName !== "run-submit") {
      return false;
    }
    const draftInput = buildRunProofConfirmationDraft({
      workspaceId: workspace.id,
      month,
      actorMemberId: actor.id,
      options,
    });
    if (!draftInput) {
      return false;
    }

    const draft = this.pendingRunProofs.create(draftInput);
    await this.sendRunProofConfirmation(interaction, draft);
    return true;
  }

  private async sendRunProofConfirmation(interaction: ChatInputCommandInteraction, draft: PendingRunProof): Promise<void> {
    const content = [
      "I read this from your screenshot:",
      `Distance: ${draft.distanceKm}km`,
      `Date: ${draft.runDate}`,
      draft.source ? `Source: ${draft.source}` : undefined,
      "",
      "Confirm to log it, or cancel and submit typed values if OCR misread it.",
    ]
      .filter((line) => line !== undefined)
      .join("\n");
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`run-proof:confirm:${draft.id}`)
        .setLabel("Log Run")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`run-proof:cancel:${draft.id}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary),
    );

    if (interaction.deferred) {
      await interaction.editReply({ content, components: [row] });
      return;
    }

    await interaction.reply({ content, components: [row], ephemeral: true });
  }

  private parseRunProofAction(customId: string): { kind: "confirm" | "cancel"; draftId: string } | undefined {
    const match = /^run-proof:(confirm|cancel):(.+)$/.exec(customId);
    if (!match) {
      return undefined;
    }

    return {
      kind: match[1] as "confirm" | "cancel",
      draftId: match[2] ?? "",
    };
  }

  private async replyWithSleepProofConfirmation(
    interaction: ChatInputCommandInteraction,
    workspace: Workspace,
    actor: Member,
    month: MonthKey,
    options: Record<string, string | number | undefined>,
  ): Promise<boolean> {
    if (interaction.commandName !== "sleep-submit") return false;
    const totalSleepMinutes = optionNumber(options, "total_sleep_minutes") ?? optionNumber(options, "ocr_total_sleep_minutes");
    const sleepDate = optionString(options, "sleep_date") ?? optionString(options, "ocr_sleep_date");
    if (totalSleepMinutes === undefined || !sleepDate) return false;
    if (optionNumber(options, "total_sleep_minutes") !== undefined && optionString(options, "sleep_date")) return false;
    const draft = this.pendingSleepProofs.create({
      workspaceId: workspace.id,
      month,
      actorMemberId: actor.id,
      proofUrl: requireOptionString(options, "proof"),
      totalSleepMinutes,
      sleepDate,
      sleepStart: optionString(options, "sleep_start") ?? optionString(options, "ocr_sleep_start"),
      sleepEnd: optionString(options, "sleep_end") ?? optionString(options, "ocr_sleep_end"),
      deepSleepMinutes: optionNumber(options, "deep_sleep_minutes") ?? optionNumber(options, "ocr_deep_sleep_minutes"),
      lightSleepMinutes: optionNumber(options, "light_sleep_minutes") ?? optionNumber(options, "ocr_light_sleep_minutes"),
      remSleepMinutes: optionNumber(options, "rem_sleep_minutes") ?? optionNumber(options, "ocr_rem_sleep_minutes"),
      awakeMinutes: optionNumber(options, "awake_minutes") ?? optionNumber(options, "ocr_awake_minutes"),
    });
    const content = ["I read this from your screenshot:", `Total sleep: ${formatMinutes(draft.totalSleepMinutes)}`, `Wake date: ${draft.sleepDate}`,
      draft.sleepStart && draft.sleepEnd ? `Window: ${draft.sleepStart}-${draft.sleepEnd}` : undefined,
      draft.deepSleepMinutes !== undefined ? `Deep: ${formatMinutes(draft.deepSleepMinutes)}` : undefined,
      draft.lightSleepMinutes !== undefined ? `Light: ${formatMinutes(draft.lightSleepMinutes)}` : undefined,
      draft.remSleepMinutes !== undefined ? `REM: ${formatMinutes(draft.remSleepMinutes)}` : undefined,
      draft.awakeMinutes !== undefined ? `Awake: ${formatMinutes(draft.awakeMinutes)}` : undefined,
      "", "Confirm to log it, or cancel and submit typed values if OCR misread it."].filter((line) => line !== undefined).join("\n");
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`sleep-proof:confirm:${draft.id}`).setLabel("Log Sleep").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`sleep-proof:cancel:${draft.id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    );
    if (interaction.deferred) await interaction.editReply({ content, components: [row] });
    else await interaction.reply({ content, components: [row], ephemeral: true });
    return true;
  }

  private parseSleepProofAction(customId: string): { kind: "confirm" | "cancel"; draftId: string } | undefined {
    const match = /^sleep-proof:(confirm|cancel):(.+)$/.exec(customId);
    return match ? { kind: match[1] as "confirm" | "cancel", draftId: match[2] ?? "" } : undefined;
  }

  private async handleSleepProofAction(interaction: ButtonInteraction, draftId: string, kind: "confirm" | "cancel"): Promise<void> {
    const workspace = await this.bootstrapWorkspace();
    const actor = await this.ensureMember(workspace, interaction.user);
    const claim = this.pendingSleepProofs.claim(draftId, (draft) => draft.workspaceId === workspace.id && draft.actorMemberId === actor.id);
    if (claim.status === "handled") { await interaction.reply({ content: "This sleep confirmation was already handled.", ephemeral: true }); return; }
    if (claim.status === "missing") { await interaction.update({ content: "This sleep confirmation expired. Upload the screenshot again.", components: [] }); return; }
    if (claim.status === "forbidden") { await interaction.reply({ content: "This sleep confirmation belongs to another member.", ephemeral: true }); return; }
    if (kind === "cancel") { await interaction.update({ content: "Sleep submission cancelled.", components: [] }); return; }
    const draft = claim.draft;
    const response = await this.handler.handleDetailed({ workspaceId: draft.workspaceId, month: draft.month, actorMemberId: draft.actorMemberId, currentDate: this.currentDate(), commandName: "sleep-submit", options: {
      proof: draft.proofUrl, total_sleep_minutes: draft.totalSleepMinutes, sleep_date: draft.sleepDate, sleep_start: draft.sleepStart, sleep_end: draft.sleepEnd, deep_sleep_minutes: draft.deepSleepMinutes, light_sleep_minutes: draft.lightSleepMinutes, rem_sleep_minutes: draft.remSleepMinutes, awake_minutes: draft.awakeMinutes,
    } });
    if (response.content.startsWith("Error:")) {
      await interaction.update({ content: response.content, components: [] });
      return;
    }
    await interaction.update({ content: "Sleep logged. Posted to the channel.", components: [] });
    await interaction.followUp({ content: response.content });
  }

  private async sendInteractionResponse(
    interaction: ChatInputCommandInteraction,
    content: string,
    extras: Pick<InteractionReplyOptions, "embeds" | "files"> = {},
    ephemeral = false,
  ): Promise<void> {
    if (interaction.deferred) {
      await interaction.editReply({ content, ...extras });
      return;
    }

    await interaction.reply({
      content,
      ...extras,
      ephemeral: content.startsWith("Error:") || ephemeral,
    });
  }

  private async ensureMember(workspace: Workspace, user: User): Promise<Member> {
    if (user.bot || user.id === this.config.clientId) {
      throw new DomainError("Bot accounts cannot participate in challenges.");
    }
    const externalUserId = user.id;
    const displayName = user.globalName ?? user.username;
    const discordAvatarUrl = this.discordAvatarUrl(user);
    return this.service.registerMember({
      workspaceId: workspace.id,
      platform: "discord",
      externalUserId,
      displayName,
      profileImageUrl: discordAvatarUrl,
      profileImageSource: discordAvatarUrl ? "platform_avatar" : undefined,
    });
  }

  private async responseExtras(
    commandName: string,
    actor: Member,
    response: DiscordCommandResponse,
  ): Promise<Pick<InteractionReplyOptions, "embeds" | "files">> {
    const extras: Pick<InteractionReplyOptions, "embeds" | "files"> = {};
    if (commandName === "status" && actor.profileImageUrl) {
      extras.embeds = [
        {
          thumbnail: { url: actor.profileImageUrl },
        },
      ];
    }

    if (response.runSummaryCard) {
      const card = await renderRunSummaryCard(response.runSummaryCard);
      extras.files = [
        {
          attachment: card.buffer,
          name: card.fileName,
        },
      ];
    }

    return extras;
  }

  private discordAvatarUrl(user: User): string | undefined {
    return user.displayAvatarURL();
  }

  private isAdmin(interaction: ChatInputCommandInteraction): boolean {
    return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
  }

  private currentMonth(): MonthKey {
    return createMonthKeyForDate(new Date(), this.config.timezone);
  }

  private currentDate(): string {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: this.config.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    return `${year}-${month}-${day}`;
  }

  private toDiscordCommand(command: SlashCommandDefinition): Record<string, unknown> {
    return {
      name: command.name,
      description: command.description,
      default_member_permissions: command.adminOnly ? PermissionFlagsBits.ManageGuild.toString() : undefined,
      options: command.options?.map((option) => this.toDiscordOption(option)) ?? [],
    };
  }

  private toDiscordOption(option: SlashCommandOption): Record<string, unknown> {
    const types: Record<SlashCommandOption["type"], ApplicationCommandOptionType> = {
      string: ApplicationCommandOptionType.String,
      number: ApplicationCommandOptionType.Number,
      integer: ApplicationCommandOptionType.Integer,
      attachment: ApplicationCommandOptionType.Attachment,
      user: ApplicationCommandOptionType.User,
    };
    return {
      name: option.name,
      description: option.description,
      type: types[option.type],
      required: option.required,
    };
  }
}
