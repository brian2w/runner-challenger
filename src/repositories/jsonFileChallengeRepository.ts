import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  CarryoverPenalty,
  LeaderAssignment,
  Member,
  MonthlyChallenge,
  MonthlyGoal,
  MonthlyResult,
  PunishmentRecord,
  RunSubmission,
  NotificationIntent,
  NotificationAudience,
  Workspace,
} from "../core/types.js";
import { memberIdentityId, workspaceIntegrationId } from "../core/identityIds.js";
import type { MemberIdentity, WorkspaceIntegration } from "../application/platformIdentityRepository.js";
import { InMemoryChallengeRepository } from "./inMemoryChallengeRepository.js";

interface RepositorySnapshot {
  workspaces: Workspace[];
  workspaceIntegrations: WorkspaceIntegration[];
  members: Member[];
  memberIdentities: MemberIdentity[];
  challenges: MonthlyChallenge[];
  leaderAssignments: LeaderAssignment[];
  goals: MonthlyGoal[];
  submissions: RunSubmission[];
  carryovers: CarryoverPenalty[];
  results: MonthlyResult[];
  punishments: PunishmentRecord[];
  notificationIntents: NotificationIntent[];
}

interface LegacyDiscordWorkspace extends Workspace {
  discordGuildId?: string;
}

interface LegacyDiscordMember extends Omit<Member, "profileImageSource"> {
  discordUserId?: string;
  profileImageSource?: "discord_avatar" | "custom_url" | "platform_avatar";
}

interface LegacyScheduledPrompt extends Omit<NotificationIntent, "audience"> {
  audience?: NotificationAudience;
  channelKey?: string;
}

export class JsonFileChallengeRepository extends InMemoryChallengeRepository {
  private ready = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {
    super();
  }

  async init(): Promise<void> {
    if (this.ready) {
      return;
    }

    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const snapshot = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<RepositorySnapshot> & {
        prompts?: LegacyScheduledPrompt[];
      };
      const legacyWorkspaces = (snapshot.workspaces ?? []) as LegacyDiscordWorkspace[];
      const legacyMembers = (snapshot.members ?? []) as LegacyDiscordMember[];
      this.loadMap(this.workspaces, legacyWorkspaces.map(({ id, name, timezone, createdAt }) => ({ id, name, timezone, createdAt })));
      this.loadMap(this.members, legacyMembers.map((member) => ({
        id: member.id,
        workspaceId: member.workspaceId,
        displayName: member.displayName,
        profileImageUrl: member.profileImageUrl,
        profileImageSource: member.profileImageSource === "discord_avatar" ? "platform_avatar" : member.profileImageSource,
        isBot: member.isBot,
        createdAt: member.createdAt,
      })));
      this.loadMap(this.challenges, snapshot.challenges);
      this.loadMap(this.leaderAssignments, snapshot.leaderAssignments);
      this.loadMap(this.goals, snapshot.goals);
      this.loadMap(this.submissions, snapshot.submissions);
      this.loadMap(this.carryovers, snapshot.carryovers);
      this.loadMap(this.results, snapshot.results);
      this.loadMap(this.punishments, snapshot.punishments);
      this.loadMap(this.workspaceIntegrations, snapshot.workspaceIntegrations);
      this.loadMap(this.memberIdentities, snapshot.memberIdentities);
      this.loadMap(
        this.notificationIntents,
        (snapshot.notificationIntents ?? snapshot.prompts)?.map(({ id, workspaceId, challengeId, month, kind, scheduledFor, audience, deliveredAt }) => ({
          id,
          workspaceId,
          challengeId,
          month,
          kind,
          scheduledFor,
          audience: audience ?? "workspace",
          deliveredAt,
        })),
      );
      if (this.migrateLegacyDiscordIdentities(legacyWorkspaces, legacyMembers) || snapshot.prompts) {
        await this.persist();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      await this.persist();
    }

    this.ready = true;
  }

  override async saveWorkspace(workspace: Workspace): Promise<void> {
    await super.saveWorkspace(workspace);
    await this.persist();
  }

  override async saveMember(member: Member): Promise<void> {
    await super.saveMember(member);
    await this.persist();
  }

  override async saveWorkspaceIntegration(integration: WorkspaceIntegration): Promise<void> {
    await super.saveWorkspaceIntegration(integration);
    await this.persist();
  }

  override async saveMemberIdentity(identity: MemberIdentity): Promise<void> {
    await super.saveMemberIdentity(identity);
    await this.persist();
  }

  override async saveChallenge(challenge: MonthlyChallenge): Promise<void> {
    await super.saveChallenge(challenge);
    await this.persist();
  }

  override async saveLeaderAssignment(assignment: LeaderAssignment): Promise<void> {
    await super.saveLeaderAssignment(assignment);
    await this.persist();
  }

  override async saveGoal(goal: MonthlyGoal): Promise<void> {
    await super.saveGoal(goal);
    await this.persist();
  }

  override async saveSubmission(submission: RunSubmission): Promise<void> {
    await super.saveSubmission(submission);
    await this.persist();
  }

  override async saveCarryoverPenalty(penalty: CarryoverPenalty): Promise<void> {
    await super.saveCarryoverPenalty(penalty);
    await this.persist();
  }

  override async saveMonthlyResult(result: MonthlyResult): Promise<void> {
    await super.saveMonthlyResult(result);
    await this.persist();
  }

  override async savePunishmentRecord(record: PunishmentRecord): Promise<void> {
    await super.savePunishmentRecord(record);
    await this.persist();
  }

  override async deletePunishmentRecord(punishmentId: string): Promise<void> {
    await super.deletePunishmentRecord(punishmentId);
    await this.persist();
  }

  override async saveNotificationIntent(intent: NotificationIntent): Promise<void> {
    await super.saveNotificationIntent(intent);
    await this.persist();
  }

  private loadMap<T extends { id: string }>(target: Map<string, T>, records: T[] | undefined): void {
    for (const record of records ?? []) {
      target.set(record.id, record);
    }
  }

  private migrateLegacyDiscordIdentities(
    workspaces: LegacyDiscordWorkspace[],
    members: LegacyDiscordMember[],
  ): boolean {
    let migrated = false;
    for (const workspace of workspaces) {
      if (workspace.discordGuildId && ![...this.workspaceIntegrations.values()].some(
        (integration) => integration.platform === "discord" && integration.externalWorkspaceId === workspace.discordGuildId,
      )) {
        this.workspaceIntegrations.set(workspaceIntegrationId("discord", workspace.discordGuildId), {
          id: workspaceIntegrationId("discord", workspace.discordGuildId),
          workspaceId: workspace.id,
          platform: "discord",
          externalWorkspaceId: workspace.discordGuildId,
          createdAt: workspace.createdAt,
        });
        migrated = true;
      }
    }
    for (const member of members) {
      if (member.discordUserId && ![...this.memberIdentities.values()].some(
        (identity) =>
          identity.workspaceId === member.workspaceId &&
          identity.platform === "discord" &&
          identity.externalUserId === member.discordUserId,
      )) {
        this.memberIdentities.set(memberIdentityId(member.workspaceId, "discord", member.discordUserId), {
          id: memberIdentityId(member.workspaceId, "discord", member.discordUserId),
          workspaceId: member.workspaceId,
          memberId: member.id,
          platform: "discord",
          externalUserId: member.discordUserId,
          createdAt: member.createdAt,
        });
        migrated = true;
      }
    }
    return migrated;
  }

  private async persist(): Promise<void> {
    const write = this.writeQueue.catch(() => undefined).then(async () => {
      const snapshot: RepositorySnapshot = {
        workspaces: [...this.workspaces.values()],
        members: [...this.members.values()],
        challenges: [...this.challenges.values()],
        leaderAssignments: [...this.leaderAssignments.values()],
        goals: [...this.goals.values()],
        submissions: [...this.submissions.values()],
        carryovers: [...this.carryovers.values()],
        results: [...this.results.values()],
        punishments: [...this.punishments.values()],
        workspaceIntegrations: [...this.workspaceIntegrations.values()],
        memberIdentities: [...this.memberIdentities.values()],
        notificationIntents: [...this.notificationIntents.values()],
      };
      const tempPath = `${this.filePath}.writing`;
      await writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`);
      await rename(tempPath, this.filePath);
    });
    this.writeQueue = write;
    await write;
  }
}
