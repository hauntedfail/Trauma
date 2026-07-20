import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/server/db/repositories", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../../src/server/db/repositories")
  >();
  return {
    ...actual,
    createRepositories() {
      throw new Error("injected repository construction failure");
    },
  };
});

import { initializeDatabase } from "../../../src/server/db";
import { acquireRuntimeProcessLease } from "../../../src/server/runtime/process-lease";
import { createRuntimeConfig } from "./runtime-lease-test-helpers";

describe("database initialization failure cleanup", () => {
  it("releases standalone ownership after return-value construction fails", async () => {
    const { config } = await createRuntimeConfig();
    expect(() => initializeDatabase(config, { runMigrations: false })).toThrow(
      /injected repository construction failure/,
    );

    const successor = acquireRuntimeProcessLease(config);
    successor.release();
  });

  it("releases a runtime borrow after return-value construction fails", async () => {
    const { config } = await createRuntimeConfig();
    const owner = acquireRuntimeProcessLease(config);
    expect(() => initializeDatabase(config, { runMigrations: false })).toThrow(
      /injected repository construction failure/,
    );
    owner.release();

    const successor = acquireRuntimeProcessLease(config);
    successor.release();
  });
});
