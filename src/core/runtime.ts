export interface MomentumRuntime {
  createId(): string;
  now(): string;
}

export const systemMomentumRuntime: MomentumRuntime = {
  createId: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
};
