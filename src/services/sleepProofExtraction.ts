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

interface DurationExtractionOptions {
  allowsTesseractEightAlias?: boolean;
  includesNearestNonEmptyLine?: boolean;
}

const SLEEP_DURATION_LABELS = ["total sleep", "duration"];
const DURATION_PATTERN = /(\d+|[Ss])\s*h(?:ours?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?|(?:(\d+)\s*m(?:in(?:utes?)?)?)/i;
const STAGE_FIELD_BY_LABEL = {
  deep: "deepSleepMinutes",
  light: "lightSleepMinutes",
  rem: "remSleepMinutes",
  awake: "awakeMinutes",
} as const;

export function extractSleepProofFields(
  ocrText: string,
  options: SleepProofExtractionOptions = {},
): ExtractedSleepProofFields {
  const totalSleepMinutes = extractDurationNearLabels(ocrText, SLEEP_DURATION_LABELS, {
    allowsTesseractEightAlias: true,
    includesNearestNonEmptyLine: true,
  });
  const timeline = extractSleepTimeline(ocrText, totalSleepMinutes);
  const stages = extractStageRows(ocrText);
  const fields: ExtractedSleepProofFields = {
    totalSleepMinutes,
    sleepDate: extractSleepDate(ocrText, options.fallbackDate),
    ...timeline,
    deepSleepMinutes: extractDurationNearLabels(ocrText, ["deep"]) ?? stages.deepSleepMinutes,
    lightSleepMinutes: extractDurationNearLabels(ocrText, ["light"]) ?? stages.lightSleepMinutes,
    remSleepMinutes: extractDurationNearLabels(ocrText, ["rem"]) ?? stages.remSleepMinutes,
    awakeMinutes: extractDurationNearLabels(ocrText, ["awake"]) ?? stages.awakeMinutes,
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as ExtractedSleepProofFields;
}

function extractDurationNearLabels(
  text: string,
  labels: readonly string[],
  options: DurationExtractionOptions = {},
): number | undefined {
  const lines = text.split(/\r?\n/);
  for (const label of labels) {
    const labelPattern = new RegExp(`\\b${label}\\b`, "i");
    const index = lines.findIndex((line) => labelPattern.test(line));
    if (index < 0) continue;
    const candidates = options.includesNearestNonEmptyLine ? nearbyNonEmptyLines(lines, index) : [lines[index] ?? ""];
    const match = candidates.map((line) => DURATION_PATTERN.exec(line)).find(Boolean);
    if (match) {
      const hours = parseHours(match[1], options.allowsTesseractEightAlias ?? false);
      const minutes = Number(match[2] ?? match[3] ?? 0);
      if (hours !== undefined && Number.isInteger(minutes) && hours >= 0 && minutes >= 0 && minutes < 60) {
        return hours * 60 + minutes;
      }
    }
  }
  return undefined;
}

function nearbyNonEmptyLines(lines: string[], index: number): string[] {
  const candidates = [lines[index] ?? ""];
  for (const step of [-1, 1]) {
    for (let candidateIndex = index + step; candidateIndex >= 0 && candidateIndex < lines.length; candidateIndex += step) {
      const candidate = lines[candidateIndex]?.trim();
      if (candidate) {
        candidates.push(candidate);
        break;
      }
    }
  }
  return candidates;
}

function extractStageRows(text: string): Pick<
  ExtractedSleepProofFields,
  "deepSleepMinutes" | "lightSleepMinutes" | "remSleepMinutes" | "awakeMinutes"
> {
  const fields: Pick<ExtractedSleepProofFields, "deepSleepMinutes" | "lightSleepMinutes" | "remSleepMinutes" | "awakeMinutes"> = {};
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length - 1; index += 1) {
    const minutes = extractDurationTokens(lines[index] ?? "");
    const labels = extractStageLabels(lines[index + 1] ?? "");
    if (minutes.length < 2 || minutes.length !== labels.length) continue;
    labels.forEach((label, labelIndex) => {
      const minutesValue = minutes[labelIndex];
      if (minutesValue !== undefined) fields[label] = minutesValue;
    });
  }
  return fields;
}

function extractDurationTokens(text: string): number[] {
  const tokens = [...text.matchAll(/(\d+)\s*h(?:ours?)?\s*(?:(\d+)\s*m(?:in(?:utes?)?)?)?|([\d]+|[Il])\s*m(?:in(?:utes?)?)?/gi)];
  return tokens
    .map((match) => {
      const hours = Number(match[1] ?? 0);
      const minuteText = match[2] ?? match[3] ?? "0";
      const minutes = /^[Il]$/i.test(minuteText) ? 1 : Number(minuteText);
      return Number.isInteger(hours) && Number.isInteger(minutes) && minutes >= 0 && minutes < 60 ? hours * 60 + minutes : undefined;
    })
    .filter((minutes): minutes is number => minutes !== undefined);
}

function extractStageLabels(text: string): Array<(typeof STAGE_FIELD_BY_LABEL)[keyof typeof STAGE_FIELD_BY_LABEL]> {
  const labels = [...text.matchAll(/\b(deep|light|rem|awake)\b/gi)];
  return labels.flatMap((label) => {
    const field = STAGE_FIELD_BY_LABEL[label[1]?.toLowerCase() as keyof typeof STAGE_FIELD_BY_LABEL];
    return field ? [field] : [];
  });
}

function parseHours(value: string | undefined, allowsTesseractEightAlias: boolean): number | undefined {
  if (!value) return 0;
  if (/^s$/i.test(value)) return allowsTesseractEightAlias ? 8 : undefined;
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

function extractSleepTimeline(text: string, totalSleepMinutes?: number): Pick<ExtractedSleepProofFields, "sleepStart" | "sleepEnd"> {
  const section = text.split(/sleep timeline/i)[1];
  if (!section) return {};
  const times = [...section.matchAll(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/gi)]
    .map((match) => normalizeTime(Number(match[1]), Number(match[2]), match[3]))
    .filter((time): time is string => time !== undefined);
  const first = times[0];
  const last = times.at(-1);
  if (!first || !last || first === last) return {};
  if (totalSleepMinutes === undefined) {
    return { sleepStart: first, sleepEnd: last };
  }
  const inOcrOrder = sleepWindowDuration(first, last);
  const reversed = sleepWindowDuration(last, first);
  return Math.abs(inOcrOrder - totalSleepMinutes) <= Math.abs(reversed - totalSleepMinutes)
    ? { sleepStart: first, sleepEnd: last }
    : { sleepStart: last, sleepEnd: first };
}

function sleepWindowDuration(start: string, end: string): number {
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  return endMinutes > startMinutes ? endMinutes - startMinutes : endMinutes + 24 * 60 - startMinutes;
}

function timeToMinutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
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
