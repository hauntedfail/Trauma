import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadBrowseMemories } from "../../../src/server/memories/browse";

describe("browse memory loader error policy", () => {
  it("surfaces missing required config instead of rendering an empty archive", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "trauma-missing-config-"));

    await withCwd(cwd, async () => {
      await expect(loadBrowseMemories()).rejects.toThrow(/Missing trauma config/);
    });
  });
});

async function withCwd<T>(cwd: string, callback: () => Promise<T>): Promise<T> {
  const previousCwd = process.cwd();
  process.chdir(cwd);
  try {
    return await callback();
  } finally {
    process.chdir(previousCwd);
  }
}
