import { deepEqual, equal } from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRunProofConfirmationDraft } from "../src/adapters/discord/runProofConfirmation.js";

describe("buildRunProofConfirmationDraft", () => {
  it("builds a confirmation draft from OCR-only run proof options", () => {
    const draft = buildRunProofConfirmationDraft({
      workspaceId: "workspace-1",
      month: "2026-07",
      actorMemberId: "member-1",
      options: {
        proof: "https://cdn.example/proof.png",
        ocr_distance_km: 13.78,
        ocr_run_date: "2026-07-05",
        source: "Garmin",
        note: "Morning",
      },
    });

    deepEqual(draft, {
      workspaceId: "workspace-1",
      month: "2026-07",
      actorMemberId: "member-1",
      proofUrl: "https://cdn.example/proof.png",
      distanceKm: 13.78,
      runDate: "2026-07-05",
      source: "Garmin",
      note: "Morning",
    });
  });

  it("uses typed values before OCR suggestions when one field is omitted", () => {
    const draft = buildRunProofConfirmationDraft({
      workspaceId: "workspace-1",
      month: "2026-07",
      actorMemberId: "member-1",
      options: {
        proof: "https://cdn.example/proof.png",
        distance_km: 13.7,
        ocr_distance_km: 13.78,
        ocr_run_date: "2026-07-05",
      },
    });

    equal(draft?.distanceKm, 13.7);
    equal(draft?.runDate, "2026-07-05");
  });

  it("does not build a draft when typed fields are complete", () => {
    const draft = buildRunProofConfirmationDraft({
      workspaceId: "workspace-1",
      month: "2026-07",
      actorMemberId: "member-1",
      options: {
        proof: "https://cdn.example/proof.png",
        distance_km: 13.78,
        run_date: "2026-07-05",
        ocr_distance_km: 13.78,
        ocr_run_date: "2026-07-05",
      },
    });

    equal(draft, undefined);
  });
});
