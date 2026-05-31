import {
  ApplicationCommandOptionType,
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
  type ChatInputCommandInteraction,
  type User,
} from "discord.js";
import { DomainError } from "../../core/errors.js";
import { createMonthKeyForDate } from "../../core/time.js";
import type { DiscordWorkspace, Member, MonthKey } from "../../core/types.js";
import type { ChallengeRepository } from "../../repositories/challengeRepository.js";
import type { ChallengeService } from "../../services/challengeService.js";
import { encodeStravaOAuthState } from "../strava/oauthState.js";
import type { StravaOAuthClient } from "../strava/stravaProvider.js";
import { slashCommands, type SlashCommandDefinition, type SlashCommandOption } from "./commandCatalog.js";
import { DiscordCommandHandler } from "./discordCommandHandler.js";

export interface DiscordBotConfig {
  token: string;
  clientId: string;
  guildId: string;
  workspaceName: string;
  timezone: string;
  channelRefs: DiscordWorkspace["channelRefs"];
  stravaStateSecret: string;
}

export class RunnerChallengeDiscordBot {
  private readonly client = new Client({ intents: [GatewayIntentBits.Guilds] });
  private readonly handler: DiscordCommandHandler;

  constructor(
    private readonly config: DiscordBotConfig,
    private readonly service: ChallengeService,
    private readonly repository: ChallengeRepository,
    private readonly stravaClient?: StravaOAuthClient,
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
      if (!interaction.isChatInputCommand()) {
        return;
      }
      await this.handleInteraction(interaction);
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

      if (interaction.commandName === "strava-connect") {
        await this.replyWithStravaUrl(interaction, workspace, actor);
        return;
      }

      const options = await this.commandOptions(interaction, workspace);
      const reply = await this.handler.handle({
        workspaceId: workspace.id,
        month,
        actorMemberId: actor.id,
        isAdmin: this.isAdmin(interaction),
        commandName: interaction.commandName,
        options,
      });

      await interaction.reply({
        content: reply,
        ephemeral: reply.startsWith("Error:"),
      });
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
  ): Promise<Record<string, string | number | undefined>> {
    switch (interaction.commandName) {
      case "goal-set":
        return { distance_km: interaction.options.getNumber("distance_km", true) };
      case "run-submit":
        return {
          distance_km: interaction.options.getNumber("distance_km", true),
          run_date: interaction.options.getString("run_date", true),
          screenshot: interaction.options.getAttachment("screenshot", true).url,
        };
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

  private async replyWithStravaUrl(
    interaction: ChatInputCommandInteraction,
    workspace: DiscordWorkspace,
    member: Member,
  ): Promise<void> {
    if (!this.stravaClient) {
      await interaction.reply({ content: "Strava is not configured on this bot.", ephemeral: true });
      return;
    }

    const state = encodeStravaOAuthState(
      { workspaceId: workspace.id, memberId: member.id },
      this.config.stravaStateSecret,
    );
    await interaction.reply({
      content: `Connect Strava here: ${this.stravaClient.buildAuthorizeUrl(state)}`,
      ephemeral: true,
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
