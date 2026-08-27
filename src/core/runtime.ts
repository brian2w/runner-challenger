export interface MomentumRuntime {
  createId(): string;
  now(): string;
}

export const systemMomentumRuntime: MomentumRuntime = {
  createId: () => randomUUID(),
  now: () => new Date().toISOString(),
};
import { randomUUID } from "node:crypto";
