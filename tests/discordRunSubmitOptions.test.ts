import { deepEqual, equal } from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveRunSubmitOptions } from "../src/adapters/discord/runSubmitOptions.js";
import type { OcrProvider } from "../src/ocr/ocrProvider.js";

class FakeOcrProvider implements OcrProvider {
  calls = 0;

  constructor(private readonly text: string) {}

  async extractText(): Promise<{ text: string }> {
    this.calls += 1;
    return { text: this.text };
  }
}

describe("resolveRunSubmitOptions", () => {
  it("returns OCR suggestions without filling submitted distance/date", async () => {
    const ocr = new FakeOcrProvider("Run\nDistance\n5.24 km\nDate\n2026-07-05");

    const options = await resolveRunSubmitOptions(
      {
        proofUrl: "https://cdn.example/proof.png",
        month: "2026-07",
      },
      ocr,
    );

    deepEqual(options, {
      proof: "https://cdn.example/proof.png",
      distance_km: undefined,
      run_date: undefined,
      source: undefined,
      note: undefined,
      ocr_distance_km: 5.24,
      ocr_run_date: "2026-07-05",
    });
  });

  it("does not OCR when distance and date are already typed", async () => {
    const ocr = new FakeOcrProvider("Distance 99 km 2026-07-05");

    const options = await resolveRunSubmitOptions(
      {
        proofUrl: "https://cdn.example/proof.png",
        month: "2026-07",
        distanceKm: 4.2,
        runDate: "2026-07-03",
      },
      ocr,
    );

    equal(ocr.calls, 0);
    equal(options.distance_km, 4.2);
    equal(options.run_date, "2026-07-03");
  });

  it("keeps typed values while OCR suggests omitted fields", async () => {
    const ocr = new FakeOcrProvider("Distance 13.78 km\n5 Jul");

    const options = await resolveRunSubmitOptions(
      {
        proofUrl: "https://cdn.example/proof.png",
        month: "2026-07",
        distanceKm: 13.7,
      },
      ocr,
    );

    equal(options.distance_km, 13.7);
    equal(options.run_date, undefined);
    equal(options.ocr_distance_km, 13.78);
    equal(options.ocr_run_date, "2026-07-05");
  });

  it("passes fallback date through for today-style screenshots", async () => {
    const ocr = new FakeOcrProvider("Today at 8:30 AM\nDistance\n13.78 km");

    const options = await resolveRunSubmitOptions(
      {
        proofUrl: "https://cdn.example/proof.png",
        month: "2026-07",
        fallbackDate: "2026-07-05",
      },
      ocr,
    );

    equal(options.ocr_distance_km, 13.78);
    equal(options.ocr_run_date, "2026-07-05");
  });
});
