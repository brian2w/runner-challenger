import { deepEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { slashCommands } from "../src/adapters/discord/commandCatalog.js";

describe("slashCommands", () => {
  it("registers the proof-first command catalog", () => {
    const commandNames = slashCommands.map((command) => command.name);

    deepEqual(commandNames, [
      "goal-set",
      "run-submit",
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
  });
});
