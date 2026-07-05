import { equal, throws } from "node:assert/strict";
import { describe, it } from "node:test";
import { createOcrProvider } from "../src/ocr/createOcrProvider.js";
import { TesseractOcrProvider } from "../src/ocr/tesseractOcrProvider.js";

describe("createOcrProvider", () => {
  it("creates Tesseract as the default local OCR provider", () => {
    const provider = createOcrProvider({});

    equal(provider instanceof TesseractOcrProvider, true);
  });

  it("disables OCR explicitly", () => {
    equal(createOcrProvider({ provider: "none" }), undefined);
  });

  it("rejects unknown providers instead of silently using Tesseract", () => {
    throws(() => createOcrProvider({ provider: "paddle" }), /Unknown OCR_PROVIDER/);
  });
});
