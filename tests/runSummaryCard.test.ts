import { equal, ok } from "node:assert/strict";
import { describe, it } from "node:test";
import sharp from "sharp";
import {
  formatRunSummaryDate,
  renderRunSummaryCard,
  selectRunSummaryIncentive,
} from "../src/cards/runSummaryCard.js";

describe("run summary card renderer", () => {
  it("formats run dates for the card", () => {
    equal(formatRunSummaryDate("2026-07-05"), "5 Jul 2026");
  });

  it("selects a deterministic rotating incentive image", () => {
    equal(selectRunSummaryIncentive("submission-1"), selectRunSummaryIncentive("submission-1"));
    ok(selectRunSummaryIncentive("submission-1").endsWith(".png"));
  });

  it("renders a PNG run summary card at the template size", async () => {
    const card = await renderRunSummaryCard({
      submissionId: "submission-1",
      runDate: "2026-07-05",
      distanceKm: 13.78,
      remainingPersonalKm: 86.22,
      remainingGroupKm: 512.4,
      submitterName: "Brian Wang",
      profileImageUrl:
        "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4Ij48cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgZmlsbD0iIzNhYTdmZiIvPjxjaXJjbGUgY3g9IjY0IiBjeT0iNDgiIHI9IjI0IiBmaWxsPSIjZmZkM2E2Ii8+PHBhdGggZD0iTTI0IDEyMGMxMi00MCA2OC00MCA4MCAweiIgZmlsbD0iIzU4ZTQ2ZiIvPjwvc3ZnPg==",
    });

    equal(card.submissionId, "submission-1");
    equal(card.fileName, "run-summary-submission-1.png");
    equal(card.contentType, "image/png");
    equal(card.buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");

    const metadata = await sharp(card.buffer).metadata();
    equal(metadata.width, 1402);
    equal(metadata.height, 1122);
  });
});
