import { Database } from "bun:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ensureE2eRuntimeFixture } from "../../e2e/bun-fixture";

describe("ensureE2eRuntimeFixture", () => {
  it("creates and migrates an isolated E2E runtime from an empty root", async () => {
    const root = await mkdtemp(join(tmpdir(), "trauma-e2e-runtime-"));

    try {
      ensureE2eRuntimeFixture(root);

      const configPath = join(root, "trauma.config.json");
      const config = JSON.parse(await readFile(configPath, "utf8")) as {
        databasePath: string;
        projectPath: string;
        storePath: string;
      };
      expect(config).toMatchObject({
        databasePath: "./runtime/trauma.sqlite",
        projectPath: "./project",
        storePath: "./project/store",
      });

      const database = new Database(join(root, "runtime/trauma.sqlite"), {
        readonly: true,
      });
      try {
        expect(
          database
            .query("select name from sqlite_master where type = 'table' and name = 'app_settings'")
            .get(),
        ).toEqual({ name: "app_settings" });
      } finally {
        database.close();
      }

      const initialConfig = await readFile(configPath, "utf8");
      ensureE2eRuntimeFixture(root);
      await expect(readFile(configPath, "utf8")).resolves.toBe(initialConfig);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
