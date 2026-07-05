import { deepEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { extractRunProofFields } from "../src/services/runProofExtraction.js";

describe("extractRunProofFields", () => {
  it("extracts distance and ISO date from OCR text", () => {
    const result = extractRunProofFields("Morning Run\nDistance\n5.24 km\nDate\n2026-07-05");

    deepEqual(result, {
      distanceKm: 5.24,
      runDate: "2026-07-05",
    });
  });

  it("extracts month-name dates using the fallback year", () => {
    const result = extractRunProofFields("Garmin\nRun\n8.7 km\n5 Jul", { fallbackYear: 2026 });

    deepEqual(result, {
      distanceKm: 8.7,
      runDate: "2026-07-05",
    });
  });

  it("prefers distance-label values in noisy OCR text", () => {
    const result = extractRunProofFields("Calories 400 kcal\nAvg Pace 5:30 /km\nDistance\n10.12 km\nJUL 6", {
      fallbackYear: 2026,
    });

    deepEqual(result, {
      distanceKm: 10.12,
      runDate: "2026-07-06",
    });
  });

  it("extracts day-first slash dates by default", () => {
    const result = extractRunProofFields("Run\nDistance 6.3 km\n05/07/2026");

    deepEqual(result, {
      distanceKm: 6.3,
      runDate: "2026-07-05",
    });
  });

  it("uses fallback date when OCR text says today", () => {
    const result = extractRunProofFields("Today at 8:30 AM\nDistance\n13.78 km", {
      fallbackDate: "2026-07-05",
    });

    deepEqual(result, {
      distanceKm: 13.78,
      runDate: "2026-07-05",
    });
  });
});
