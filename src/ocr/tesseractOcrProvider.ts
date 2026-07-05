import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { OcrInput, OcrProvider, OcrResult } from "./ocrProvider.js";

const execFileAsync = promisify(execFile);

export class TesseractOcrProvider implements OcrProvider {
  constructor(
    private readonly config: {
      binaryPath?: string;
      language?: string;
      workDir?: string;
      timeoutMs?: number;
      maxImageBytes?: number;
    } = {},
  ) {}

  async extractText(input: OcrInput): Promise<OcrResult> {
    const workDir = this.config.workDir ?? ".tmp/ocr";
    await mkdir(workDir, { recursive: true });
    const imagePath = `${workDir}/${randomUUID()}`;

    try {
      const response = await fetch(input.imageUrl, {
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 15_000),
      });
      if (!response.ok) {
        throw new Error(`Proof image download failed with HTTP ${response.status}.`);
      }
      const contentType = response.headers.get("content-type");
      if (contentType && !contentType.startsWith("image/")) {
        throw new Error("Proof OCR requires an image attachment.");
      }

      const bytes = await this.readLimitedResponse(response);
      await writeFile(imagePath, bytes);

      const { stdout } = await execFileAsync(
        this.config.binaryPath ?? "tesseract",
        [imagePath, "stdout", "-l", this.config.language ?? "eng", "--psm", "12"],
        { timeout: this.config.timeoutMs ?? 15_000, maxBuffer: 2 * 1024 * 1024 },
      );
      return { text: stdout };
    } finally {
      await rm(imagePath, { force: true });
    }
  }

  private async readLimitedResponse(response: Response): Promise<Buffer> {
    const maxImageBytes = this.config.maxImageBytes ?? 8 * 1024 * 1024;
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxImageBytes) {
      throw new Error(`Proof image is too large for OCR. Limit is ${maxImageBytes} bytes.`);
    }

    if (!response.body) {
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > maxImageBytes) {
        throw new Error(`Proof image is too large for OCR. Limit is ${maxImageBytes} bytes.`);
      }
      return bytes;
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for (;;) {
      const read = await reader.read();
      if (read.done) {
        break;
      }
      totalBytes += read.value.byteLength;
      if (totalBytes > maxImageBytes) {
        throw new Error(`Proof image is too large for OCR. Limit is ${maxImageBytes} bytes.`);
      }
      chunks.push(Buffer.from(read.value));
    }

    return Buffer.concat(chunks, totalBytes);
  }
}
