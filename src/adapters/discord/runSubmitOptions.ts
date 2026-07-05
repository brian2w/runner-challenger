import { extractRunProofFields } from "../../services/runProofExtraction.js";
import type { MonthKey } from "../../core/types.js";
import type { OcrProvider } from "../../ocr/ocrProvider.js";

export interface RunSubmitOptionInput {
  proofUrl: string;
  month: MonthKey;
  distanceKm?: number;
  runDate?: string;
  source?: string;
  note?: string;
  fallbackDate?: string;
}

export async function resolveRunSubmitOptions(
  input: RunSubmitOptionInput,
  ocrProvider?: OcrProvider,
): Promise<Record<string, string | number | undefined>> {
  const base = {
    proof: input.proofUrl,
    distance_km: input.distanceKm,
    run_date: input.runDate,
    source: input.source,
    note: input.note,
  };
  if (!ocrProvider || (input.distanceKm !== undefined && input.runDate)) {
    return base;
  }

  try {
    const result = await ocrProvider.extractText({ imageUrl: input.proofUrl });
    const extracted = extractRunProofFields(result.text, {
      fallbackYear: Number(input.month.slice(0, 4)),
      fallbackDate: input.fallbackDate,
    });
    return {
      ...base,
      ocr_distance_km: extracted.distanceKm,
      ocr_run_date: extracted.runDate,
    };
  } catch {
    return base;
  }
}
