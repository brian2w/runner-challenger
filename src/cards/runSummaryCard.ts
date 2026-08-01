import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const TEMPLATE_PATH = join(process.cwd(), "assets", "run-summary", "template.png");
const INCENTIVE_DIR = join(process.cwd(), "assets", "run-summary", "incentives");
const INCENTIVES = ["finish-line-caricature.png", "neon-track-caricature.png", "night-runner-caricature.png"];
const TEMPLATE_WIDTH = 1402;
const TEMPLATE_HEIGHT = 1122;
const PROFILE_IMAGE_TIMEOUT_MS = 2_500;
const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;

export interface RunSummaryCardInput {
  submissionId: string;
  runDate: string;
  distanceKm: number;
  remainingPersonalKm: number;
  remainingGroupKm: number;
  submitterName: string;
  profileImageUrl?: string;
}

export interface RenderedRunSummaryCard {
  submissionId: string;
  fileName: string;
  contentType: "image/png";
  buffer: Buffer;
}

export function formatRunSummaryDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map((part) => Number.parseInt(part, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function selectRunSummaryIncentive(seed: string): string {
  const hash = [...seed].reduce((value, char) => ((value << 5) - value + char.charCodeAt(0)) | 0, 0);
  const index = Math.abs(hash) % INCENTIVES.length;
  return join(INCENTIVE_DIR, INCENTIVES[index]);
}

export async function renderRunSummaryCard(input: RunSummaryCardInput): Promise<RenderedRunSummaryCard> {
  const [incentive, avatar] = await Promise.all([
    renderIncentivePanel(selectRunSummaryIncentive(input.submissionId)),
    renderProfileAvatar(input),
  ]);
  const overlay = Buffer.from(renderTextOverlay(input));
  const buffer = await sharp(TEMPLATE_PATH)
    .composite([
      { input: incentive, left: 866, top: 268 },
      { input: overlay, left: 0, top: 0 },
      { input: avatar, left: 874, top: 82 },
    ])
    .png()
    .toBuffer();

  return {
    submissionId: input.submissionId,
    fileName: `run-summary-${sanitizeFilePart(input.submissionId)}.png`,
    contentType: "image/png",
    buffer,
  };
}

async function renderIncentivePanel(assetPath: string): Promise<Buffer> {
  const asset = await readFile(assetPath);
  const image = await sharp(asset)
    .resize(452, 650, { fit: "cover" })
    .png()
    .toBuffer();
  const mask = Buffer.from(`
    <svg width="452" height="650" viewBox="0 0 452 650" xmlns="http://www.w3.org/2000/svg">
      <rect width="452" height="650" rx="34" fill="#fff"/>
    </svg>
  `);
  return sharp(image)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

function renderTextOverlay(input: RunSummaryCardInput): string {
  return `
    <svg width="${TEMPLATE_WIDTH}" height="${TEMPLATE_HEIGHT}" viewBox="0 0 ${TEMPLATE_WIDTH} ${TEMPLATE_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect x="866" y="72" width="430" height="72" rx="34" fill="#101922" opacity="0.88"/>
      <text
        x="944"
        y="102"
        font-family="Arial, Helvetica, sans-serif"
        font-size="20"
        font-weight="700"
        fill="#8f9aa6"
      >SUBMITTED BY</text>
      <text
        x="944"
        y="129"
        font-family="Arial, Helvetica, sans-serif"
        font-size="27"
        font-weight="900"
        fill="#f2f7fb"
      >${escapeXml(trimText(input.submitterName, 20))}</text>
      ${valueBackdrop(598, 284)}
      ${valueBackdrop(598, 476)}
      ${valueBackdrop(598, 668)}
      ${valueBackdrop(598, 852)}
      ${valueText(700, 313, formatRunSummaryDate(input.runDate), "#f2f7fb", 30)}
      ${valueText(700, 505, `${formatKm(input.distanceKm)}km`, "#f2f7fb", 34)}
      ${valueText(700, 697, `${formatKm(input.remainingPersonalKm)}km`, "#f2f7fb", 34)}
      ${valueText(700, 881, `${formatKm(input.remainingGroupKm)}km`, "#f2f7fb", 34)}
    </svg>
  `;
}

async function renderProfileAvatar(input: RunSummaryCardInput): Promise<Buffer> {
  const source = input.profileImageUrl ? await loadImage(input.profileImageUrl).catch(() => undefined) : undefined;
  const avatar = source
    ? await sharp(source).resize(56, 56, { fit: "cover" }).png().toBuffer()
    : Buffer.from(renderInitialsAvatar(input.submitterName));
  const mask = Buffer.from(`
    <svg width="56" height="56" viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg">
      <circle cx="28" cy="28" r="28" fill="#fff"/>
    </svg>
  `);
  return sharp(avatar)
    .resize(56, 56, { fit: "cover" })
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

async function loadImage(url: string): Promise<Buffer> {
  if (url.startsWith("data:")) {
    const [, data = ""] = url.split(",", 2);
    const buffer = Buffer.from(data, url.includes(";base64,") ? "base64" : "utf8");
    if (buffer.length > MAX_PROFILE_IMAGE_BYTES) {
      throw new Error("Profile image is too large.");
    }
    return buffer;
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(PROFILE_IMAGE_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Profile image request failed with HTTP ${response.status}.`);
  }
  const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_PROFILE_IMAGE_BYTES) {
    throw new Error("Profile image is too large.");
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_PROFILE_IMAGE_BYTES) {
    throw new Error("Profile image is too large.");
  }
  return buffer;
}

function renderInitialsAvatar(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "R";
  return `
    <svg width="56" height="56" viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg">
      <rect width="56" height="56" fill="#3aa7ff"/>
      <circle cx="42" cy="12" r="22" fill="#58e46f" opacity="0.75"/>
      <text x="28" y="35" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="900" fill="#f2f7fb">${escapeXml(initials)}</text>
    </svg>
  `;
}

function valueBackdrop(x: number, y: number): string {
  return `<rect x="${x}" y="${y}" width="204" height="58" rx="16" fill="#111922" opacity="0.96"/>`;
}

function valueText(x: number, y: number, value: string, color: string, size: number): string {
  return `
    <text
      x="${x}"
      y="${y}"
      text-anchor="middle"
      dominant-baseline="middle"
      font-family="Arial, Helvetica, sans-serif"
      font-size="${size}"
      font-weight="800"
      fill="${color}"
      letter-spacing="1"
    >${escapeXml(value)}</text>
  `;
}

function formatKm(value: number): string {
  const rounded = Math.max(0, Math.round(value * 100) / 100);
  return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function trimText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
