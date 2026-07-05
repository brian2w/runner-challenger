import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

export function loadLocalEnv(path = ".env"): void {
  if (existsSync(path)) {
    loadEnvFile(path);
  }
}
