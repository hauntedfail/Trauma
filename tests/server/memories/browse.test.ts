import { describe, expect, it } from "vitest";

import { TraumaConfigError } from "../../../src/server/config";
import { canRenderEmptyBrowse } from "../../../src/server/memories/browse";

describe("browse memory loader error policy", () => {
  it("renders empty browse only for missing local config", () => {
    expect(canRenderEmptyBrowse(new TraumaConfigError("Missing trauma config at trauma.config.json"))).toBe(true);
  });

  it("surfaces missing SQLite runtime failures", () => {
    expect(
      canRenderEmptyBrowse(
        new Error("Bun SQLite runtime is required to initialize Trauma database: Cannot find module 'bun:sqlite'"),
      ),
    ).toBe(false);
  });
});
