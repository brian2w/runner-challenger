export interface ExtractedSleepProofFields {
  totalSleepMinutes?: number;
  sleepDate?: string;
  sleepStart?: string;
  sleepEnd?: string;
  deepSleepMinutes?: number;
  lightSleepMinutes?: number;
  remSleepMinutes?: number;
  awakeMinutes?: number;
}

export interface SleepProofExtractionOptions {
  fallbackDate?: string;
}

const SLEEP_DURATION_LABELS = ["total sleep", "duration"];

export function extractSleepProofFields(
  ocrText: string,
  options: SleepProofExtractionOptions = {},
): ExtractedSleepProofFields {
  const fields: ExtractedSleepProofFields = {
    totalSleepMinutes: extractDurationNearLabels(ocrText, SLEEP_DURATION_LABELS),
    sleepDate: extractSleepDate(ocrText, options.fallbackDate),
    sleepStart: extractTimeAfterBoundary(ocrText, /sleep timeline/i),
    sleepEnd: extractLastTime(ocrText),
    deepSleepMinutes: extractDurationNearLabels(ocrText, ["deep"]),
    lightSleepMinutes: extractDurationNearLabels(ocrText, ["light"]),
    remSleepMinutes: extractDurationNearLabels(ocrText, ["rem"]),
    awakeMinutes: extractDurationNearLabels(ocrText, ["awake"]),
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as ExtractedSleepProofFields;
}

function extractDurationNearLabels(text: string, labels: readonly string[]): number | undefined {
  const lines = text.split(/\r?\n/);
  const durationPattern = /([\dSs])\s*h(?:ours?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?|(?:(\d+)\s*m(?:in(?:utes?)?)?)/i;
  for (const label of labels) {
    const labelPattern = new RegExp(`\\b${label}\\b`, "i");
    const index = lines.findIndex((line) => labelPattern.test(line));
    if (index < 0) continue;
    const candidates = [lines[index] ?? "", lines[index - 1] ?? "", lines[index + 1] ?? ""];
    const match = candidates.map((line) => durationPattern.exec(line)).find(Boolean);
    if (match) {
      const hours = parseOcrHours(match[1]);
      const minutes = Number(match[2] ?? match[3] ?? 0);
      if (hours !== undefined && Number.isInteger(minutes) && hours >= 0 && minutes >= 0 && minutes < 60) {
        return hours * 60 + minutes;
      }
    }
  }
  return undefined;
}

function parseOcrHours(value: string | undefined): number | undefined {
  if (!value) return 0;
  if (/^s$/i.test(value)) return 8;
  const hours = Number(value);
  return Number.isInteger(hours) ? hours : undefined;
}

function extractSleepDate(text: string, fallbackDate?: string): string | undefined {
  const iso = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(text);
  if (iso) {
    return formatDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }
  if (/\byesterday\b/i.test(text) && fallbackDate) {
    return shiftDate(fallbackDate, -1);
  }
  if (/\btoday\b/i.test(text) && fallbackDate) {
    return fallbackDate;
  }
  return undefined;
}

function extractTimeAfterBoundary(text: string, boundary: RegExp): string | undefined {
  const section = text.split(boundary)[1];
  return section ? extractFirstTime(section) : undefined;
}

function extractFirstTime(text: string): string | undefined {
  const match = /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i.exec(text);
  return match ? normalizeTime(Number(match[1]), Number(match[2]), match[3]) : undefined;
}

function extractLastTime(text: string): string | undefined {
  const matches = [...text.matchAll(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/gi)];
  const match = matches.at(-1);
  return match ? normalizeTime(Number(match[1]), Number(match[2]), match[3]) : undefined;
}

function normalizeTime(hour: number, minute: number, meridiem?: string): string | undefined {
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute > 59) return undefined;
  let normalizedHour = hour;
  if (meridiem) {
    if (hour < 1 || hour > 12) return undefined;
    normalizedHour = hour % 12 + (meridiem.toLowerCase() === "pm" ? 12 : 0);
  }
  if (normalizedHour > 23) return undefined;
  return `${normalizedHour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

function formatDate(year: number, month: number, day: number): string | undefined {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`
    : undefined;
}

function shiftDate(date: string, days: number): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return undefined;
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return formatDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}
