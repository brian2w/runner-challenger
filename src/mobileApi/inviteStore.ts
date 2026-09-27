import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type Invite = {
  codeHash: string;
  workspaceId: string;
  expiresAt: string;
  revokedAt?: string;
};

export interface InviteStore {
  save(invite: Invite): Promise<void>;
  get(code: string): Promise<Invite | undefined>;
  revoke(code: string, workspaceId: string, revokedAt: string): Promise<boolean>;
}

export function hashInviteCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export class JsonInviteStore implements InviteStore {
  private invites = new Map<string, Invite>();

  constructor(private readonly filePath: string) {}

  async init(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, "utf8"));
      if (!Array.isArray(parsed)) throw new Error("Invalid invite data.");
      for (const value of parsed) {
        if (!value || typeof value !== "object") throw new Error("Invalid invite data.");
        const invite = value as Partial<Invite>;
        if (!invite.codeHash || !/^[a-f0-9]{64}$/.test(invite.codeHash) || typeof invite.workspaceId !== "string" || typeof invite.expiresAt !== "string" || (invite.revokedAt !== undefined && typeof invite.revokedAt !== "string")) {
          throw new Error("Invalid invite data.");
        }
        this.invites.set(invite.codeHash, invite as Invite);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async save(invite: Invite): Promise<void> {
    const previous = this.invites.get(invite.codeHash);
    this.invites.set(invite.codeHash, invite);
    try {
      await this.persist();
    } catch (error) {
      if (previous) this.invites.set(previous.codeHash, previous);
      else this.invites.delete(invite.codeHash);
      throw error;
    }
  }

  async get(code: string): Promise<Invite | undefined> {
    return this.invites.get(hashInviteCode(code));
  }

  async revoke(code: string, workspaceId: string, revokedAt: string): Promise<boolean> {
    const invite = await this.get(code);
    if (!invite || invite.workspaceId !== workspaceId) return false;
    if (!invite.revokedAt) {
      this.invites.set(invite.codeHash, { ...invite, revokedAt });
      try {
        await this.persist();
      } catch (error) {
        this.invites.set(invite.codeHash, invite);
        throw error;
      }
    }
    return true;
  }

  private async persist(): Promise<void> {
    const tempPath = `${this.filePath}.writing`;
    await writeFile(tempPath, `${JSON.stringify([...this.invites.values()], null, 2)}\n`, { mode: 0o600 });
    await rename(tempPath, this.filePath);
  }
}
