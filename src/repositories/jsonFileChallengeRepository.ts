import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  CarryoverPenalty,
  DiscordWorkspace,
  LeaderAssignment,
  Member,
  MonthlyChallenge,
  MonthlyGoal,
  MonthlyResult,
  PunishmentRecord,
  RunSubmission,
  ScheduledPrompt,
  StravaConnection,
} from "../core/types.js";
import { InMemoryChallengeRepository } from "./inMemoryChallengeRepository.js";

interface RepositorySnapshot {
  workspaces: DiscordWorkspace[];
  members: Member[];
  challenges: MonthlyChallenge[];
  leaderAssignments: LeaderAssignment[];
  goals: MonthlyGoal[];
  submissions: RunSubmission[];
  carryovers: CarryoverPenalty[];
  results: MonthlyResult[];
  punishments: PunishmentRecord[];
  prompts: ScheduledPrompt[];
  stravaConnections: StravaConnection[];
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
      const snapshot = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<RepositorySnapshot>;
      this.loadMap(this.workspaces, snapshot.workspaces);
      this.loadMap(this.members, snapshot.members);
      this.loadMap(this.challenges, snapshot.challenges);
      this.loadMap(this.leaderAssignments, snapshot.leaderAssignments);
      this.loadMap(this.goals, snapshot.goals);
      this.loadMap(this.submissions, snapshot.submissions);
      this.loadMap(this.carryovers, snapshot.carryovers);
      this.loadMap(this.results, snapshot.results);
      this.loadMap(this.punishments, snapshot.punishments);
      this.loadMap(this.prompts, snapshot.prompts);
      for (const connection of snapshot.stravaConnections ?? []) {
        this.stravaConnections.set(connection.memberId, connection);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      await this.persist();
    }

    this.ready = true;
  }

  override async saveWorkspace(workspace: DiscordWorkspace): Promise<void> {
    await super.saveWorkspace(workspace);
    await this.persist();
  }

  override async saveMember(member: Member): Promise<void> {
    await super.saveMember(member);
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

  override async saveScheduledPrompt(prompt: ScheduledPrompt): Promise<void> {
    await super.saveScheduledPrompt(prompt);
    await this.persist();
  }

  override async saveStravaConnection(connection: StravaConnection): Promise<void> {
    await super.saveStravaConnection(connection);
    await this.persist();
  }

  private loadMap<T extends { id: string }>(target: Map<string, T>, records: T[] | undefined): void {
    for (const record of records ?? []) {
      target.set(record.id, record);
    }
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
        prompts: [...this.prompts.values()],
        stravaConnections: [...this.stravaConnections.values()],
      };
      const tempPath = `${this.filePath}.writing`;
      await writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`);
      await rename(tempPath, this.filePath);
    });
    this.writeQueue = write;
    await write;
  }
}
