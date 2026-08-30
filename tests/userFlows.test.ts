import { deepEqual } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { slashCommands } from "../src/adapters/discord/commandCatalog.js";

describe("USER_FLOWS documentation", () => {
  it("covers exactly the registered slash commands", async () => {
    const flowDocument = await readFile(new URL("../../docs/USER_FLOWS.md", import.meta.url), "utf8");
    const documentedCommands = [...flowDocument.matchAll(/^### `\/([a-z0-9-]+)`$/gm)].map((match) => match[1]);

    deepEqual(documentedCommands.sort(), slashCommands.map((command) => command.name).sort());
  });
});
