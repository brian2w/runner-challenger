import { deepEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { extractSleepProofFields } from "../src/services/sleepProofExtraction.js";

describe("extractSleepProofFields", () => {
  it("extracts the Garmin summary labels and timeline", () => {
    deepEqual(
      extractSleepProofFields(
        "Today\n7h 46m\nTotal Sleep\n3h 20m Deep\n4h 7m Light\n19m REM\n1m Awake\nSleep Timeline\n11:28 pm\n7:15 am",
        { fallbackDate: "2026-08-31" },
      ),
      {
        totalSleepMinutes: 466,
        sleepDate: "2026-08-31",
        sleepStart: "23:28",
        sleepEnd: "07:15",
        deepSleepMinutes: 200,
        lightSleepMinutes: 247,
        remSleepMinutes: 19,
        awakeMinutes: 1,
      },
    );
  });

  it("does not invent fields when labels are absent", () => {
    deepEqual(extractSleepProofFields("Garmin Sleep\nToday", { fallbackDate: "2026-08-31" }), {
      sleepDate: "2026-08-31",
    });
  });
});
