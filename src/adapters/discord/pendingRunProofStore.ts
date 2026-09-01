import { randomUUID } from "node:crypto";
import type { MonthKey } from "../../core/types.js";

export interface PendingProof {
  id: string;
  workspaceId: string;
  actorMemberId: string;
  createdAtMs: number;
}

export interface PendingRunProof extends PendingProof {
  month: MonthKey;
  proofUrl: string;
  distanceKm: number;
  runDate: string;
  source?: string;
  note?: string;
}

export type PendingProofClaimResult<T extends PendingProof> =
  | { status: "claimed"; draft: T }
  | { status: "forbidden"; draft: T }
  | { status: "handled" }
  | { status: "missing" };

export class PendingProofStore<T extends PendingProof> {
  private readonly pending = new Map<string, T>();
  private readonly handled = new Map<string, number>();

  constructor(private readonly ttlMs = 10 * 60 * 1000) {}

  create(input: Omit<T, "id" | "createdAtMs">, nowMs = Date.now()): T {
    this.prune(nowMs);
    const draft = {
      ...input,
      id: randomUUID(),
      createdAtMs: nowMs,
    } as T;
    this.pending.set(draft.id, draft);
    return draft;
  }

  take(id: string, nowMs = Date.now()): T | undefined {
    this.prune(nowMs);
    const draft = this.pending.get(id);
    if (!draft) {
      return undefined;
    }

    this.pending.delete(id);
    this.handled.set(id, nowMs);
    return draft;
  }

  get(id: string, nowMs = Date.now()): T | undefined {
    this.prune(nowMs);
    return this.pending.get(id);
  }

  delete(id: string): boolean {
    return this.pending.delete(id);
  }

  claim(
    id: string,
    canClaim: (draft: T) => boolean,
    nowMs = Date.now(),
  ): PendingProofClaimResult<T> {
    this.prune(nowMs);
    const draft = this.pending.get(id);
    if (!draft) {
      if (this.handled.has(id)) {
        return { status: "handled" };
      }
      return { status: "missing" };
    }
    if (!canClaim(draft)) {
      return { status: "forbidden", draft };
    }

    this.pending.delete(id);
    this.handled.set(id, nowMs);
    return { status: "claimed", draft };
  }

  private prune(nowMs: number): void {
    for (const [id, draft] of this.pending) {
      if (nowMs - draft.createdAtMs > this.ttlMs) {
        this.pending.delete(id);
      }
    }
    for (const [id, handledAtMs] of this.handled) {
      if (nowMs - handledAtMs > this.ttlMs) {
        this.handled.delete(id);
      }
    }
  }
}

export class PendingRunProofStore extends PendingProofStore<PendingRunProof> {}
