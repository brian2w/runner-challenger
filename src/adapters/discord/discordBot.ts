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
  type User,
} from "discord.js";
import { DomainError } from "../../core/errors.js";
import { createMonthKeyForDate } from "../../core/time.js";
import type { DiscordWorkspace, Member, MonthKey } from "../../core/types.js";
import type { OcrProvider } from "../../ocr/ocrProvider.js";
import type { ChallengeRepository } from "../../repositories/challengeRepository.js";
import type { ChallengeService } from "../../services/challengeService.js";
import { slashCommands, type SlashCommandDefinition, type SlashCommandOption } from "./commandCatalog.js";
import { DiscordCommandHandler } from "./discordCommandHandler.js";
import { PendingRunProofStore, type PendingRunProof } from "./pendingRunProofStore.js";
import { buildRunProofConfirmationDraft } from "./runProofConfirmation.js";
import { resolveRunSubmitOptions } from "./runSubmitOptions.js";

export interface DiscordBotConfig {
  token: string;
  clientId: string;
  guildId: string;
  workspaceName: string;
  timezone: string;
  channelRefs: DiscordWorkspace["channelRefs"];
}

export class RunnerChallengeDiscordBot {
  private readonly client = new Client({ intents: [GatewayIntentBits.Guilds] });
  private readonly handler: DiscordCommandHandler;
  private readonly pendingRunProofs = new PendingRunProofStore();

  constructor(
    private readonly config: DiscordBotConfig,
    private readonly service: ChallengeService,
    private readonly repository: ChallengeRepository,
    private readonly ocrProvider?: OcrProvider,
  ) {
    this.handler = new DiscordCommandHandler(service, repository);
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

  async bootstrapWorkspace(): Promise<DiscordWorkspace> {
    const existing = await this.repository.getWorkspaceByGuildId(this.config.guildId);
    const workspace =
      existing ??
      (await this.service.createWorkspace({
        name: this.config.workspaceName,
        discordGuildId: this.config.guildId,
        timezone: this.config.timezone,
        channelRefs: this.config.channelRefs,
      }));

    await this.service.startMonth({
      workspaceId: workspace.id,
      month: this.currentMonth(),
    });
    await this.service.registerMember({
      workspaceId: workspace.id,
      discordUserId: this.config.clientId,
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

      const reply = await this.handler.handle({
        workspaceId: workspace.id,
        month,
        actorMemberId: actor.id,
        isAdmin: this.isAdmin(interaction),
        commandName: interaction.commandName,
        options,
      });

      await this.sendInteractionResponse(interaction, reply);
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
        const reply = await this.handler.handle({
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
        await interaction.update({ content: reply, components: [] });
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
    workspace: DiscordWorkspace,
    month: MonthKey,
  ): Promise<Record<string, string | number | undefined>> {
    switch (interaction.commandName) {
      case "goal-set":
        return { distance_km: interaction.options.getNumber("distance_km", true) };
      case "run-submit":
        return this.runSubmitOptions(interaction, month);
      case "admin-start-month":
      case "admin-close-month":
        return { month: interaction.options.getString("month", true) };
      case "admin-assign-leader": {
        const user = interaction.options.getUser("member", true);
        const member = await this.ensureMember(workspace, user);
        return { member_id: member.id };
      }
      case "punishments": {
        const user = interaction.options.getUser("member");
        if (!user) {
          return {};
        }
        const member = await this.ensureMember(workspace, user);
        return { member_id: member.id };
      }
      case "admin-override-run":
        return {
          submission_id: interaction.options.getString("submission_id", true),
          action: interaction.options.getString("action", true),
          distance_km: interaction.options.getNumber("distance_km") ?? undefined,
        };
      case "leader-record-punishment": {
        const user = interaction.options.getUser("member", true);
        const member = await this.ensureMember(workspace, user);
        return { member_id: member.id, note: interaction.options.getString("note", true) };
      }
      case "leader-remove-punishment":
        return { punishment_id: interaction.options.getString("punishment_id", true) };
      case "admin-record-punishment": {
        const user = interaction.options.getUser("member", true);
        const member = await this.ensureMember(workspace, user);
        return { member_id: member.id, note: interaction.options.getString("note", true) };
      }
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

  private shouldUseOcr(interaction: ChatInputCommandInteraction): boolean {
    return (
      interaction.commandName === "run-submit" &&
      Boolean(this.ocrProvider) &&
      (interaction.options.getNumber("distance_km") === null || interaction.options.getString("run_date") === null)
    );
  }

  private async replyWithRunProofConfirmation(
    interaction: ChatInputCommandInteraction,
    workspace: DiscordWorkspace,
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

  private async sendInteractionResponse(interaction: ChatInputCommandInteraction, content: string): Promise<void> {
    if (interaction.deferred) {
      await interaction.editReply({ content });
      return;
    }

    await interaction.reply({
      content,
      ephemeral: content.startsWith("Error:"),
    });
  }

  private async ensureMember(workspace: DiscordWorkspace, user: User): Promise<Member> {
    if (user.bot || user.id === this.config.clientId) {
      throw new DomainError("Bot accounts cannot participate in challenges.");
    }
    const discordUserId = user.id;
    const displayName = user.globalName ?? user.username;
    const existing = await this.repository.getMemberByDiscordUserId(workspace.id, discordUserId);
    if (existing) {
      if (existing.displayName !== displayName) {
        const updated = { ...existing, displayName };
        await this.repository.saveMember(updated);
        return updated;
      }
      return existing;
    }

    return this.service.registerMember({
      workspaceId: workspace.id,
      discordUserId,
      displayName,
    });
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
