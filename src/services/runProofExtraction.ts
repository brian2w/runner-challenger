export interface ExtractedRunProofFields {
  distanceKm?: number;
  runDate?: string;
}

export interface RunProofExtractionOptions {
  fallbackYear?: number;
  fallbackDate?: string;
}

const monthNumbers = new Map<string, number>([
  ["jan", 1],
  ["january", 1],
  ["feb", 2],
  ["february", 2],
  ["mar", 3],
  ["march", 3],
  ["apr", 4],
  ["april", 4],
  ["may", 5],
  ["jun", 6],
  ["june", 6],
  ["jul", 7],
  ["july", 7],
  ["aug", 8],
  ["august", 8],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
  ["oct", 10],
  ["october", 10],
  ["nov", 11],
  ["november", 11],
  ["dec", 12],
  ["december", 12],
]);

export function extractRunProofFields(
  ocrText: string,
  options: RunProofExtractionOptions = {},
): ExtractedRunProofFields {
  return {
    distanceKm: extractDistanceKm(ocrText),
    runDate: extractRunDate(ocrText, options),
  };
}

function extractDistanceKm(text: string): number | undefined {
  const distanceSectionMatch = text.match(/distance[\s\S]{0,40}?(\d+(?:[.,]\d+)?)\s*k(?:m|ilomet(?:er|re)s?)\b/i);
  const match = distanceSectionMatch ?? text.match(/\b(\d+(?:[.,]\d+)?)\s*k(?:m|ilomet(?:er|re)s?)\b/i);
  if (!match) {
    return undefined;
  }

  const distance = Number(match[1]?.replace(",", "."));
  return Number.isFinite(distance) && distance > 0 ? Math.round(distance * 100) / 100 : undefined;
}

function extractRunDate(text: string, options: RunProofExtractionOptions): string | undefined {
  if (/\btoday\b/i.test(text) && options.fallbackDate) {
    return options.fallbackDate;
  }

  const isoMatch = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (isoMatch) {
    return formatIsoDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  const slashMatch = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (slashMatch) {
    return formatIsoDate(Number(slashMatch[3]), Number(slashMatch[2]), Number(slashMatch[1]));
  }

  for (const dayMonthMatch of text.matchAll(/\b(\d{1,2})\s+([A-Za-z]+)\s*(\d{4})?\b/g)) {
    const date = dateFromParts(dayMonthMatch[2], dayMonthMatch[1], dayMonthMatch[3], options);
    if (date) {
      return date;
    }
  }

  for (const monthDayMatch of text.matchAll(/\b([A-Za-z]+)\s+(\d{1,2})(?:,)?\s*(\d{4})?\b/g)) {
    const date = dateFromParts(monthDayMatch[1], monthDayMatch[2], monthDayMatch[3], options);
    if (date) {
      return date;
    }
  }

  return undefined;
}

function dateFromParts(
  monthName: string | undefined,
  dayText: string | undefined,
  yearText: string | undefined,
  options: RunProofExtractionOptions,
): string | undefined {
  if (!monthName || !dayText) {
    return undefined;
  }

  const month = monthNumbers.get(monthName.toLowerCase());
  const year = yearText ? Number(yearText) : options.fallbackYear;
  if (!month || !year) {
    return undefined;
  }

  return formatIsoDate(year, month, Number(dayText));
}

function formatIsoDate(year: number, month: number, day: number): string | undefined {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return undefined;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }

  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day
    .toString()
    .padStart(2, "0")}`;
}
