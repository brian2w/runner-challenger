import { deepEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { extractRunProofFields } from "../src/services/runProofExtraction.js";
import { suggestRunProofFields } from "../packages/run-proof/index.js";

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

  it("uses the previous fallback date when OCR text says yesterday", () => {
    const result = extractRunProofFields("Yesterday at 8:00 AM\nDistance\n5.06 km", {
      fallbackDate: "2026-07-19",
    });

    deepEqual(result, {
      distanceKm: 5.06,
      runDate: "2026-07-18",
    });
  });

  it("handles yesterday across month and year boundaries", () => {
    const result = extractRunProofFields("YESTERDAY at 11:30 PM\nDistance\n3.2 km", {
      fallbackDate: "2026-01-01",
    });

    deepEqual(result, {
      distanceKm: 3.2,
      runDate: "2025-12-31",
    });
  });

  it("prefers an explicit event date over a relative activity label", () => {
    const result = extractRunProofFields("Yesterday at 8:00 AM\nJul 18\nDistance\n5.06 km", {
      fallbackDate: "2026-08-08",
      fallbackYear: 2026,
    });

    deepEqual(result, {
      distanceKm: 5.06,
      runDate: "2026-07-18",
    });
  });
});

describe("suggestRunProofFields", () => {
  it("suggests one distinct kilometer distance and full date", () => {
    deepEqual(suggestRunProofFields("Distance\n5,24 km\nOctober 18, 2026\n5.24 km"), {
      distanceKm: 5.24,
      runDate: "2026-10-18",
    });
    for (const date of ["2026-10-18", "18 October 2026", "18/10/2026", "10/18/2026", "10/10/2026"]) {
      deepEqual(suggestRunProofFields(date), { runDate: date === "10/10/2026" ? "2026-10-10" : "2026-10-18" });
    }
  });

  it("keeps a full date ahead of relative labels without inventing missing dates", () => {
    deepEqual(suggestRunProofFields("Yesterday\nDistance 5 km\n18 Oct 2026"), {
      distanceKm: 5,
      runDate: "2026-10-18",
    });
    for (const date of ["Today", "Yesterday", "18 Oct", "Oct 18", "05/07/2026", "2026-02-30"]) {
      deepEqual(suggestRunProofFields(`Distance 5 km\n${date}`), { distanceKm: 5 });
    }
  });

  it("abstains only for the conflicting field", () => {
    deepEqual(suggestRunProofFields("Distance 5 km\nLap 1 km\n2026-10-18"), { runDate: "2026-10-18" });
    deepEqual(suggestRunProofFields("Distance 5 km\n2026-10-18\n19 Oct 2026"), { distanceKm: 5 });
    deepEqual(suggestRunProofFields("Distance 5 km\n2026-10-18\n2026-02-30"), { distanceKm: 5 });
  });

  it("does not repair invalid distances or convert unsupported units", () => {
    for (const distance of ["0 km", "501 km", "5.245 km", "-5 km", "1e2 km", "1,234.5 km", "3.1 mi", "500 m", "5:30 /km", "Average speed 12 km/h", "12 km / hr", "12 km/hour", "12 km per hour"]) {
      deepEqual(suggestRunProofFields(`${distance}\n2026-10-18`), { runDate: "2026-10-18" });
    }
    deepEqual(suggestRunProofFields("5 km\n501 km\n2026-10-18"), { runDate: "2026-10-18" });
    deepEqual(suggestRunProofFields("Distance 5 km\nAverage speed 12 km/h\n2026-10-18"), {
      distanceKm: 5,
      runDate: "2026-10-18",
    });
  });
});
