import { deepEqual, equal } from "node:assert/strict";
import { describe, it } from "node:test";
import { slashCommands } from "../src/adapters/discord/commandCatalog.js";

describe("slashCommands", () => {
  it("registers the proof-first command catalog", () => {
    const commandNames = slashCommands.map((command) => command.name);

    deepEqual(commandNames, [
      "goal-set",
      "run-submit",
      "sleep-submit",
      "sleep-leaderboard",
      "sleep-status",
      "sleep-insights",
      "profile-set",
      "leaderboard",
      "status",
      "punishments",
      "leader-help",
      "admin-start-month",
      "admin-close-month",
      "admin-assign-leader",
      "leader-record-punishment",
      "leader-remove-punishment",
      "admin-override-run",
      "admin-record-punishment",
    ]);

    const removePunishment = slashCommands.find((command) => command.name === "leader-remove-punishment");
    equal(removePunishment?.options?.[0]?.type, "integer");
    const sleepSubmit = slashCommands.find((command) => command.name === "sleep-submit");
    equal(sleepSubmit?.options?.find((option) => option.name === "total_sleep_minutes")?.type, "integer");
    deepEqual(sleepSubmit?.options?.filter((option) => option.type === "attachment").map(({ name, required }) => ({ name, required })), [
      { name: "proof", required: true },
      { name: "proof_2", required: false },
      { name: "proof_3", required: false },
      { name: "proof_4", required: false },
      { name: "proof_5", required: false },
    ]);
  });
});
