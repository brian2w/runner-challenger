import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { equal } from "node:assert/strict";
import { describe, it } from "node:test";
import { loadLocalEnv } from "../src/config/loadEnv.js";

describe("loadLocalEnv", () => {
  it("loads variables from an env file when it exists", () => {
    const envPath = ".tmp/env-loader-test.env";
    delete process.env.RUNNER_CHALLENGER_TEST_ENV;
    mkdirSync(".tmp", { recursive: true });
    writeFileSync(envPath, "RUNNER_CHALLENGER_TEST_ENV=from-file\n");

    try {
      loadLocalEnv(envPath);

      equal(process.env.RUNNER_CHALLENGER_TEST_ENV, "from-file");
    } finally {
      delete process.env.RUNNER_CHALLENGER_TEST_ENV;
      rmSync(envPath, { force: true });
    }
  });

  it("ignores a missing env file", () => {
    loadLocalEnv(".tmp/missing-env-loader-test.env");
  });
});
