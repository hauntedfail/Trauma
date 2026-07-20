import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ensureE2eServerBootFixture } from "../../../e2e/server-bootstrap";
import { loadTraumaConfig } from "../../../src/server/config";
import { initializeDatabase } from "../../../src/server/db";
import { resetE2eFixture } from "../../../src/server/e2e/fixture-reset";
import {
  ensureRuntimeProcessLease,
  runtimeLeaseInputsForConfig,
} from "../../../src/server/runtime/process-lease";
import {
  createTrackedTemporaryRoot,
  expectRuntimeRejected,
  spawnWorker,
} from "./runtime-lease-test-helpers";

describe("E2E runtime lease integration", () => {
  it("keeps reset fixture storage protected until every active borrow releases", async () => {
    const workspaceRoot = await createTrackedTemporaryRoot();
    const fixtureRoot = join(workspaceRoot, ".trauma/e2e");
    const configPath = ensureE2eServerBootFixture(fixtureRoot);
    const config = loadTraumaConfig({ configPath });
    const lease = ensureRuntimeProcessLease(config);
    let connection: ReturnType<typeof initializeDatabase> | undefined;

    try {
      await resetE2eFixture("read_only", { root: fixtureRoot });
      const resetConfig = loadTraumaConfig({ configPath });
      const resources = runtimeLeaseInputsForConfig(resetConfig);
      expect(lease.admits(resources)).toBe(true);
      expect(lease.reserves(resources)).toBe(true);
      expect(() => lease.assertCovers(resources)).not.toThrow();
      await expectRuntimeRejected(resetConfig, /already active/);

      connection = initializeDatabase(resetConfig);
      lease.release();
      await expectRuntimeRejected(resetConfig, /already active/);
      connection.close();
      connection = undefined;

      const restarted = spawnWorker(resetConfig, "once");
      await expect(restarted.nextStdout()).resolves.toMatchObject({
        type: "acquired",
      });
      await expect(restarted.nextStdout()).resolves.toMatchObject({
        type: "initialized",
      });
      await expect(restarted.nextStdout()).resolves.toMatchObject({
        type: "released",
      });
      await expect(restarted.exit).resolves.toBe(0);
    } finally {
      connection?.close();
      lease.release();
    }
  });
});
