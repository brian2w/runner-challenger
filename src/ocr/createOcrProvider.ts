import type { OcrProvider } from "./ocrProvider.js";
import { TesseractOcrProvider } from "./tesseractOcrProvider.js";

export interface OcrProviderConfig {
  provider?: string;
  tesseractBinary?: string;
  tesseractLanguage?: string;
}

export function createOcrProvider(config: OcrProviderConfig): OcrProvider | undefined {
  const provider = config.provider ?? "tesseract";
  if (provider === "none") {
    return undefined;
  }
  if (provider === "tesseract") {
    return new TesseractOcrProvider({
      binaryPath: config.tesseractBinary || undefined,
      language: config.tesseractLanguage || "eng",
    });
  }

  throw new Error(`Unknown OCR_PROVIDER: ${provider}`);
}
