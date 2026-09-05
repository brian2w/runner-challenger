import { deepEqual, equal } from "node:assert/strict";
import { describe, it } from "node:test";
import type { OcrInput, OcrProvider } from "../src/ocr/ocrProvider.js";
import { resolveSleepSubmitOptions } from "../src/adapters/discord/sleepSubmitOptions.js";

class MultiProofOcrProvider implements OcrProvider {
  readonly inputs: OcrInput[] = [];

  async extractText(input: OcrInput): Promise<{ text: string }> {
    this.inputs.push(input);
    return input.imageUrl.endsWith("overview.png")
      ? { text: "Today\n6h 59m\nTotal Sleep" }
      : { text: "1h 11m 3h 51m\nDeep Light\n1h 57m 5m\nREM Awake" };
  }
}

describe("resolveSleepSubmitOptions", () => {
  it("merges complementary fields from up to five screenshots using sparse OCR", async () => {
    const provider = new MultiProofOcrProvider();

    const options = await resolveSleepSubmitOptions({
      proofUrls: ["https://cdn.example/overview.png", "https://cdn.example/stages.png"],
      fallbackDate: "2026-09-05",
    }, provider);

    deepEqual(options, {
      proof: "https://cdn.example/overview.png",
      total_sleep_minutes: undefined,
      sleep_date: undefined,
      sleep_start: undefined,
      sleep_end: undefined,
      deep_sleep_minutes: undefined,
      light_sleep_minutes: undefined,
      rem_sleep_minutes: undefined,
      awake_minutes: undefined,
      ocr_total_sleep_minutes: 419,
      ocr_sleep_date: "2026-09-05",
      ocr_sleep_start: undefined,
      ocr_sleep_end: undefined,
      ocr_deep_sleep_minutes: 71,
      ocr_light_sleep_minutes: 231,
      ocr_rem_sleep_minutes: 117,
      ocr_awake_minutes: 5,
      ocr_conflict: undefined,
    });
    equal(provider.inputs.length, 2);
    provider.inputs.forEach((input) => equal(input.layout, "sparse"));
  });

  it("reports conflicting required values until the participant types them", async () => {
    const provider: OcrProvider = {
      async extractText(input) {
        return { text: input.imageUrl.endsWith("first.png") ? "Today\n7h 0m\nTotal Sleep" : "Today\n8h 0m\nTotal Sleep" };
      },
    };

    const options = await resolveSleepSubmitOptions({
      proofUrls: ["https://cdn.example/first.png", "https://cdn.example/second.png"],
      fallbackDate: "2026-09-05",
    }, provider);

    equal(options.ocr_conflict, "total sleep");
    equal(options.ocr_total_sleep_minutes, undefined);
  });

  it("does not infer a supporting proof date when the overview has an explicit date", async () => {
    const provider: OcrProvider = {
      async extractText(input) {
        return input.imageUrl.endsWith("overview.png")
          ? { text: "2026-09-05\n7h 0m\nTotal Sleep" }
          : { text: "Yesterday\n1h 11m\nDeep" };
      },
    };

    const options = await resolveSleepSubmitOptions({
      proofUrls: ["https://cdn.example/overview.png", "https://cdn.example/supporting.png"],
      fallbackDate: "2026-09-05",
    }, provider);

    equal(options.ocr_sleep_date, "2026-09-05");
    equal(options.ocr_conflict, undefined);
  });
});
