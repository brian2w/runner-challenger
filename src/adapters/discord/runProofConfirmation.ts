import { DomainError } from "../../core/errors.js";
import type { MonthKey } from "../../core/types.js";

export interface RunProofConfirmationInput {
  workspaceId: string;
  month: MonthKey;
  actorMemberId: string;
  options: Record<string, string | number | undefined>;
}

export interface RunProofConfirmationDraftInput {
  workspaceId: string;
  month: MonthKey;
  actorMemberId: string;
  proofUrl: string;
  distanceKm: number;
  runDate: string;
  source?: string;
  note?: string;
}

export function buildRunProofConfirmationDraft(
  input: RunProofConfirmationInput,
): RunProofConfirmationDraftInput | undefined {
  const typedDistanceKm = optionNumber(input.options, "distance_km");
  const typedRunDate = optionString(input.options, "run_date");
  if (typedDistanceKm !== undefined && typedRunDate) {
    return undefined;
  }

  const distanceKm = typedDistanceKm ?? optionNumber(input.options, "ocr_distance_km");
  const runDate = typedRunDate ?? optionString(input.options, "ocr_run_date");
  if (distanceKm === undefined || !runDate) {
    return undefined;
  }

  return {
    workspaceId: input.workspaceId,
    month: input.month,
    actorMemberId: input.actorMemberId,
    proofUrl: requireOptionString(input.options, "proof"),
    distanceKm,
    runDate,
    source: optionString(input.options, "source"),
    note: optionString(input.options, "note"),
  };
}

function requireOptionString(options: Record<string, string | number | undefined>, key: string): string {
  const value = optionString(options, key);
  if (!value) {
    throw new DomainError(`Missing required option: ${key}`);
  }
  return value;
}

function optionString(options: Record<string, string | number | undefined>, key: string): string | undefined {
  const value = options[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionNumber(options: Record<string, string | number | undefined>, key: string): number | undefined {
  const value = options[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
