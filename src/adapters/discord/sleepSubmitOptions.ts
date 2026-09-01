import { extractSleepProofFields } from "../../services/sleepProofExtraction.js";
import type { OcrProvider } from "../../ocr/ocrProvider.js";

export interface SleepSubmitOptionInput {
  proofUrl: string;
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
    proof: input.proofUrl,
    total_sleep_minutes: input.totalSleepMinutes,
    sleep_date: input.sleepDate,
    sleep_start: input.sleepStart,
    sleep_end: input.sleepEnd,
    deep_sleep_minutes: input.deepSleepMinutes,
    light_sleep_minutes: input.lightSleepMinutes,
    rem_sleep_minutes: input.remSleepMinutes,
    awake_minutes: input.awakeMinutes,
  };
  if (!ocrProvider || (input.totalSleepMinutes !== undefined && input.sleepDate)) return base;
  try {
    const result = await ocrProvider.extractText({ imageUrl: input.proofUrl, layout: "block" });
    const extracted = extractSleepProofFields(result.text, { fallbackDate: input.fallbackDate });
    return {
      ...base,
      ocr_total_sleep_minutes: extracted.totalSleepMinutes,
      ocr_sleep_date: extracted.sleepDate,
      ocr_sleep_start: extracted.sleepStart,
      ocr_sleep_end: extracted.sleepEnd,
      ocr_deep_sleep_minutes: extracted.deepSleepMinutes,
      ocr_light_sleep_minutes: extracted.lightSleepMinutes,
      ocr_rem_sleep_minutes: extracted.remSleepMinutes,
      ocr_awake_minutes: extracted.awakeMinutes,
    };
  } catch {
    return base;
  }
}
