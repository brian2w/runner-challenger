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

  it("extracts Garmin Sleep Score duration layouts", () => {
    deepEqual(
      extractSleepProofFields(
        "Sleep Score\nToday\n91\nExcellent\n8h 24m\nDuration\nOptimal sleep stages",
        { fallbackDate: "2026-09-01" },
      ),
      {
        totalSleepMinutes: 504,
        sleepDate: "2026-09-01",
      },
    );
  });

  it("extracts a Garmin duration when OCR keeps its label and value on one line", () => {
    deepEqual(
      extractSleepProofFields("Sleep Score\nYesterday\nDuration 7h 30m", { fallbackDate: "2026-09-01" }),
      {
        totalSleepMinutes: 450,
        sleepDate: "2026-08-31",
      },
    );
  });

  it("handles Tesseract reading the large Garmin 8 as S", () => {
    deepEqual(
      extractSleepProofFields("Today\n\nSh 21m\n\nTotal Sleep", { fallbackDate: "2026-09-02" }),
      {
        totalSleepMinutes: 501,
        sleepDate: "2026-09-02",
      },
    );
  });

  it("uses total sleep to correct reversed timeline times from Tesseract", () => {
    deepEqual(
      extractSleepProofFields("Today\nSh 21m\nTotal Sleep\nSleep Timeline\n7:25am\n11:03pm", { fallbackDate: "2026-09-02" }),
      {
        totalSleepMinutes: 501,
        sleepDate: "2026-09-02",
        sleepStart: "23:03",
        sleepEnd: "07:25",
      },
    );
  });

  it("does not assign two-column stage values without label-local OCR", () => {
    deepEqual(
      extractSleepProofFields("Today\n8h 21m\nTotal Sleep\n2h 47m\n4h 43m\nDeep\nLight\n51m\n1m\nREM\nAwake", {
        fallbackDate: "2026-09-02",
      }),
      {
        totalSleepMinutes: 501,
        sleepDate: "2026-09-02",
      },
    );
  });

  it("keeps multi-digit total sleep durations intact", () => {
    deepEqual(
      extractSleepProofFields("Today\n10h 15m\nTotal Sleep", { fallbackDate: "2026-09-02" }),
      {
        totalSleepMinutes: 615,
        sleepDate: "2026-09-02",
      },
    );
  });

  it("does not invent fields when labels are absent", () => {
    deepEqual(extractSleepProofFields("Garmin Sleep\nToday", { fallbackDate: "2026-08-31" }), {
      sleepDate: "2026-08-31",
    });
  });
});
