import { equal } from "node:assert/strict";
import { describe, it } from "node:test";
import { PendingRunProofStore } from "../src/adapters/discord/pendingRunProofStore.js";

describe("PendingRunProofStore", () => {
  it("returns each draft once", () => {
    const store = new PendingRunProofStore();
    const draft = store.create(
      {
        workspaceId: "workspace-1",
        month: "2026-07",
        actorMemberId: "member-1",
        proofUrl: "https://cdn.example/proof.png",
        distanceKm: 13.78,
        runDate: "2026-07-05",
      },
      1000,
    );

    equal(store.take(draft.id, 1001)?.distanceKm, 13.78);
    equal(store.take(draft.id, 1002), undefined);
  });

  it("expires stale drafts", () => {
    const store = new PendingRunProofStore(100);
    const draft = store.create(
      {
        workspaceId: "workspace-1",
        month: "2026-07",
        actorMemberId: "member-1",
        proofUrl: "https://cdn.example/proof.png",
        distanceKm: 13.78,
        runDate: "2026-07-05",
      },
      1000,
    );

    equal(store.take(draft.id, 1101), undefined);
  });

  it("can inspect a draft before deleting it", () => {
    const store = new PendingRunProofStore();
    const draft = store.create(
      {
        workspaceId: "workspace-1",
        month: "2026-07",
        actorMemberId: "member-1",
        proofUrl: "https://cdn.example/proof.png",
        distanceKm: 13.78,
        runDate: "2026-07-05",
      },
      1000,
    );

    equal(store.get(draft.id, 1001)?.runDate, "2026-07-05");
    equal(store.take(draft.id, 1002)?.runDate, "2026-07-05");
  });

  it("claims drafts atomically for a matching member", () => {
    const store = new PendingRunProofStore();
    const draft = store.create(
      {
        workspaceId: "workspace-1",
        month: "2026-07",
        actorMemberId: "member-1",
        proofUrl: "https://cdn.example/proof.png",
        distanceKm: 13.78,
        runDate: "2026-07-05",
      },
      1000,
    );

    equal(store.claim(draft.id, (candidate) => candidate.actorMemberId === "member-2", 1001).status, "forbidden");
    equal(store.claim(draft.id, (candidate) => candidate.actorMemberId === "member-1", 1002).status, "claimed");
    equal(store.claim(draft.id, (candidate) => candidate.actorMemberId === "member-1", 1003).status, "handled");
    equal(store.claim(draft.id, (candidate) => candidate.actorMemberId === "member-1", 1000 * 60 * 11).status, "missing");
  });
});
