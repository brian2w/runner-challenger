import { randomUUID } from "node:crypto";
import type { MonthKey } from "../../core/types.js";

export interface PendingRunProof {
  id: string;
  workspaceId: string;
  month: MonthKey;
  actorMemberId: string;
  proofUrl: string;
  distanceKm: number;
  runDate: string;
  source?: string;
  note?: string;
  createdAtMs: number;
}

export type PendingRunProofClaimResult =
  | { status: "claimed"; draft: PendingRunProof }
  | { status: "forbidden"; draft: PendingRunProof }
  | { status: "handled" }
  | { status: "missing" };

export class PendingRunProofStore {
  private readonly pending = new Map<string, PendingRunProof>();
  private readonly handled = new Map<string, number>();

  constructor(private readonly ttlMs = 10 * 60 * 1000) {}

  create(input: Omit<PendingRunProof, "id" | "createdAtMs">, nowMs = Date.now()): PendingRunProof {
    this.prune(nowMs);
    const draft: PendingRunProof = {
      ...input,
      id: randomUUID(),
      createdAtMs: nowMs,
    };
    this.pending.set(draft.id, draft);
    return draft;
  }

  take(id: string, nowMs = Date.now()): PendingRunProof | undefined {
    this.prune(nowMs);
    const draft = this.pending.get(id);
    if (!draft) {
      return undefined;
    }

    this.pending.delete(id);
    this.handled.set(id, nowMs);
    return draft;
  }

  get(id: string, nowMs = Date.now()): PendingRunProof | undefined {
    this.prune(nowMs);
    return this.pending.get(id);
  }

  delete(id: string): boolean {
    return this.pending.delete(id);
  }

  claim(
    id: string,
    canClaim: (draft: PendingRunProof) => boolean,
    nowMs = Date.now(),
  ): PendingRunProofClaimResult {
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
