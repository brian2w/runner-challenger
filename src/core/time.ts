import type { MonthKey } from "./types.js";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function createMonthKey(year: number, monthOneIndexed: number): MonthKey {
  if (!Number.isInteger(year) || !Number.isInteger(monthOneIndexed) || monthOneIndexed < 1 || monthOneIndexed > 12) {
    throw new Error("Month must be a valid YYYY-MM value.");
  }
  return `${year}-${pad(monthOneIndexed)}` as MonthKey;
}

export function parseMonthKey(month: MonthKey): { year: number; monthOneIndexed: number } {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error("Month must be a valid YYYY-MM value.");
  }
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthOneIndexed = Number(monthText);
  if (!Number.isInteger(year) || !Number.isInteger(monthOneIndexed) || monthOneIndexed < 1 || monthOneIndexed > 12) {
    throw new Error("Month must be a valid YYYY-MM value.");
  }
  return {
    year,
    monthOneIndexed,
  };
}

export function parseMonthInput(month: string): MonthKey {
  const parsed = parseMonthKey(month as MonthKey);
  return createMonthKey(parsed.year, parsed.monthOneIndexed);
}

export function createMonthKeyForDate(date: Date, timezone: string): MonthKey {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  return createMonthKey(year, month);
}

export function nextMonth(month: MonthKey): MonthKey {
  const { year, monthOneIndexed } = parseMonthKey(month);
  if (monthOneIndexed === 12) {
    return createMonthKey(year + 1, 1);
  }

  return createMonthKey(year, monthOneIndexed + 1);
}

export function monthStartIso(month: MonthKey): string {
  const { year, monthOneIndexed } = parseMonthKey(month);
  return new Date(Date.UTC(year, monthOneIndexed - 1, 1, 0, 0, 0)).toISOString();
}

export function monthCloseIso(month: MonthKey): string {
  const { year, monthOneIndexed } = parseMonthKey(month);
  return new Date(Date.UTC(year, monthOneIndexed, 0, 23, 59, 59, 999)).toISOString();
}

export function addDays(iso: string, days: number): string {
  const date = new Date(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isIsoDateInMonth(date: string, month: MonthKey): boolean {
  if (!isIsoDate(date)) {
    return false;
  }
  return date.startsWith(`${month}-`);
}

export function isIsoDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return false;
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}
