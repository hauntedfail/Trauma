import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, afterEach } from "vitest";

import {
  resetRuntimeLeaseCoordinatorPathForTesting,
  setRuntimeLeaseCoordinatorPathForTesting,
} from "../../src/server/runtime/runtime-lease-coordinator";
import { releaseRuntimeProcessLeasesForTesting } from "../../src/server/runtime/process-lease";

const root = mkdtempSync(join(tmpdir(), `trauma-vitest-lease-${process.pid}-`));
const coordinatorPath = join(root, "coordinator.sqlite");
const coordinatorTemporaryRoot = tmpdir();
const previousBunOptions = process.env.BUN_OPTIONS;
const childPreloadPath = fileURLToPath(
  new URL("./runtime-lease-child.ts", import.meta.url),
);

setRuntimeLeaseCoordinatorPathForTesting(coordinatorPath);
process.env.TRAUMA_RUNTIME_TEST_CHILD = "1";
process.env.TRAUMA_TEST_RUNTIME_COORDINATOR_PATH = coordinatorPath;
process.env.TRAUMA_TEST_RUNTIME_COORDINATOR_ROOT = coordinatorTemporaryRoot;
process.env.BUN_OPTIONS = [
  previousBunOptions,
  `--preload=${childPreloadPath}`,
].filter((value) => value !== undefined && value !== "").join(" ");

afterEach(() => {
  releaseRuntimeProcessLeasesForTesting();
});

afterAll(() => {
  resetRuntimeLeaseCoordinatorPathForTesting();
  delete process.env.TRAUMA_RUNTIME_TEST_CHILD;
  delete process.env.TRAUMA_TEST_RUNTIME_COORDINATOR_PATH;
  delete process.env.TRAUMA_TEST_RUNTIME_COORDINATOR_ROOT;
  if (previousBunOptions === undefined) {
    delete process.env.BUN_OPTIONS;
  } else {
    process.env.BUN_OPTIONS = previousBunOptions;
  }
  rmSync(root, { force: true, recursive: true });
});
