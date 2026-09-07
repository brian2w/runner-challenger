import { extractSleepProofDateEvidence, extractSleepProofFields, resolveSleepProofDate } from "../../services/sleepProofExtraction.js";
import type { ExtractedSleepProofFields, SleepProofDateEvidence } from "../../services/sleepProofExtraction.js";
import type { OcrInput, OcrProvider } from "../../ocr/ocrProvider.js";

const PRIMARY_PROOF_LAYOUTS: readonly OcrInput["layout"][] = ["block", "sparse"];
const SUPPORTING_PROOF_LAYOUTS: readonly OcrInput["layout"][] = ["sparse", "block"];

export interface SleepSubmitOptionInput {
  proofUrls: readonly string[];
  fallbackDate?: string;
  totalSleepMinutes?: number;
  sleepDate?: string;
  sleepStart?: string;
  sleepEnd?: string;
  deepSleepMinutes?: number;
  lightSleepMinutes?: number;
  remSleepMinutes?: number;
  awakeMinutes?: number;
}

export async function resolveSleepSubmitOptions(
  input: SleepSubmitOptionInput,
  ocrProvider?: OcrProvider,
): Promise<Record<string, string | number | undefined>> {
  const base = {
    proof: input.proofUrls[0],
    total_sleep_minutes: input.totalSleepMinutes,
    sleep_date: input.sleepDate,
    sleep_start: input.sleepStart,
    sleep_end: input.sleepEnd,
    deep_sleep_minutes: input.deepSleepMinutes,
    light_sleep_minutes: input.lightSleepMinutes,
    rem_sleep_minutes: input.remSleepMinutes,
    awake_minutes: input.awakeMinutes,
  };
  if (!ocrProvider || (input.proofUrls.length === 1 && input.totalSleepMinutes !== undefined && input.sleepDate)) return base;
  const extracted = (await Promise.all(input.proofUrls.map((proofUrl, index) =>
    extractProofFields(proofUrl, index === 0, ocrProvider),
  ))).flat();
  const totalSleepMinutes = merge(extracted.map(({ fields }) => fields.totalSleepMinutes));
  const sleepDate = merge(extracted.map(({ dateEvidence, isPrimaryProof }) =>
    resolveSleepProofDate(dateEvidence, isPrimaryProof ? input.fallbackDate : undefined),
  ));
  const conflicts = [
    input.totalSleepMinutes === undefined && totalSleepMinutes.conflict ? "total sleep" : undefined,
    input.sleepDate === undefined && sleepDate.conflict ? "wake date" : undefined,
  ].filter((value): value is string => value !== undefined);
  return {
    ...base,
    ocr_total_sleep_minutes: totalSleepMinutes.value,
    ocr_sleep_date: sleepDate.value,
    ocr_sleep_start: merge(extracted.map(({ fields }) => fields.sleepStart)).value,
    ocr_sleep_end: merge(extracted.map(({ fields }) => fields.sleepEnd)).value,
    ocr_deep_sleep_minutes: merge(extracted.map(({ fields }) => fields.deepSleepMinutes)).value,
    ocr_light_sleep_minutes: merge(extracted.map(({ fields }) => fields.lightSleepMinutes)).value,
    ocr_rem_sleep_minutes: merge(extracted.map(({ fields }) => fields.remSleepMinutes)).value,
    ocr_awake_minutes: merge(extracted.map(({ fields }) => fields.awakeMinutes)).value,
    ocr_conflict: conflicts.length > 0 ? conflicts.join(" and ") : undefined,
  };
}

async function extractProofFields(
  proofUrl: string,
  isPrimaryProof: boolean,
  ocrProvider: OcrProvider,
): Promise<OcrProofExtraction[]> {
  const layouts = isPrimaryProof ? PRIMARY_PROOF_LAYOUTS : SUPPORTING_PROOF_LAYOUTS;
  const attempts: OcrProofExtraction[] = [];
  for (const layout of layouts) {
    try {
      const result = await ocrProvider.extractText({ imageUrl: proofUrl, layout });
      const fields = extractSleepProofFields(result.text);
      const dateEvidence = extractSleepProofDateEvidence(result.text);
      attempts.push({ fields, dateEvidence, isPrimaryProof });
      if (isPrimaryProof ? hasRequiredFields(fields, dateEvidence) : hasAnyFields(fields)) break;
    } catch (error) {
      console.warn("Sleep proof OCR failed:", error instanceof Error ? error.message : String(error));
    }
  }
  return attempts;
}

interface OcrProofExtraction {
  fields: ExtractedSleepProofFields;
  dateEvidence?: SleepProofDateEvidence;
  isPrimaryProof: boolean;
}

function hasRequiredFields(fields: ExtractedSleepProofFields, dateEvidence: SleepProofDateEvidence | undefined): boolean {
  return fields.totalSleepMinutes !== undefined && dateEvidence !== undefined;
}

function hasAnyFields(fields: ExtractedSleepProofFields): boolean {
  return Object.keys(fields).length > 0;
}

function merge<T>(values: Array<T | undefined>): { value?: T; conflict: boolean } {
  const distinct = [...new Set(values.filter((value): value is T => value !== undefined))];
  return { value: distinct.length === 1 ? distinct[0] : undefined, conflict: distinct.length > 1 };
}
