import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  createFixtureConfig,
  resolveE2eFixtureLayout,
} from "../src/server/e2e/fixture-layout";

/**
 * Create only the files needed for request middleware to acquire the runtime
 * lease. Fixture actions remain responsible for resetting application state.
 */
export function ensureE2eServerBootFixture(root?: string): string {
  const layout = resolveE2eFixtureLayout(root);
  mkdirSync(layout.storePath, { recursive: true });
  mkdirSync(dirname(layout.databasePath), { recursive: true });
  if (!existsSync(layout.configFile)) {
    writeFileSync(
      layout.configFile,
      `${JSON.stringify(createFixtureConfig(false), null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
  }
  return layout.configFile;
}
