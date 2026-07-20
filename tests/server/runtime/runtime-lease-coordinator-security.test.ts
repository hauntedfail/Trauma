import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";

import { describe, expect, it, vi } from "vitest";

import { assertOwnerPrivateFile } from "../../../src/server/runtime/runtime-lease-coordinator-storage";
import {
  acquireRuntimeProcessLease,
  resetRuntimeLeaseCoordinatorPathForTesting,
  resolveDefaultRuntimeLeaseCoordinatorPath,
  resolveRuntimeLeaseCoordinatorPath,
  runtimeLeaseInputsForConfig,
  setRuntimeLeaseCoordinatorPathForTesting,
  suspendRuntimeStorageAdmission,
} from "../../../src/server/runtime/process-lease";
import {
  createBoundGuard,
  deleteCoordinatorRow,
  insertRawCoordinatorRow,
  readCoordinatorRow,
} from "./runtime-lease-security-test-helpers";
import {
  createRuntimeConfig,
  createTrackedTemporaryRoot,
  expectRuntimeRejected,
} from "./runtime-lease-test-helpers";

describe("runtime lease coordinator security", () => {
  it("rejects exact, ancestor, symlink, and hardlink aliases of coordinator state", async () => {
    const { config, root } = await createRuntimeConfig();
    const bootstrap = acquireRuntimeProcessLease(config);
    bootstrap.release();
    const coordinatorPath = resolveRuntimeLeaseCoordinatorPath();
    const coordinatorDirectory = dirname(coordinatorPath);

    for (const projectPath of [coordinatorDirectory, dirname(coordinatorDirectory)]) {
      expect(() =>
        acquireRuntimeProcessLease({
          ...config,
          projectPath,
          storePath: join(projectPath, "store"),
        }),
      ).toThrow(/overlaps the private runtime lease coordinator/);
    }

    const alias = join(root, "coordinator-alias");
    await symlink(coordinatorDirectory, alias, "dir");
    expect(() =>
      acquireRuntimeProcessLease({
        ...config,
        projectPath: alias,
        storePath: join(alias, "store"),
      }),
    ).toThrow(/overlaps the private runtime lease coordinator/);

    const hardlink = join(root, "coordinator-hardlink.sqlite");
    await link(coordinatorPath, hardlink);
    try {
      expect(() =>
        acquireRuntimeProcessLease({
          ...config,
          databasePath: hardlink,
        }),
      ).toThrow(/owner-only regular file/);
    } finally {
      await rm(hardlink, { force: true });
    }
  });

  it("preserves filesystem identities as bigints", async () => {
    const { config } = await createRuntimeConfig();
    const lease = acquireRuntimeProcessLease(config);
    lease.release();

    const identity = assertOwnerPrivateFile(resolveRuntimeLeaseCoordinatorPath());
    expect(typeof identity.dev).toBe("bigint");
    expect(typeof identity.ino).toBe("bigint");
  });

  it("checks coordinator overlap and own guard integrity on every mutation", async () => {
    const { config, root } = await createRuntimeConfig();
    const lease = acquireRuntimeProcessLease(config);
    const coordinatorDirectory = dirname(resolveRuntimeLeaseCoordinatorPath());
    expect(() =>
      lease.expand([
        { resourceLabel: "projectPath", resourcePath: coordinatorDirectory },
      ]),
    ).toThrow(/overlaps the private runtime lease coordinator/);

    const database = new Database(resolveRuntimeLeaseCoordinatorPath());
    const row = database
      .query<{ guard_path: string }, []>(
        "SELECT guard_path FROM coordinator_leases WHERE purpose = 'runtime'",
      )
      .get();
    database.close();
    expect(row).toBeDefined();
    const alias = join(root, "guard-hardlink.sqlite");
    await link(row!.guard_path, alias);
    try {
      expect(() => lease.assertCovers(runtimeLeaseInputsForConfig(config))).toThrow(
        /owner-only regular file/,
      );
    } finally {
      await rm(alias, { force: true });
    }
    lease.release();
  });

  it("keeps local storage admission suspended after an integrity failure", async () => {
    const { config, root } = await createRuntimeConfig();
    const lease = acquireRuntimeProcessLease(config);
    const row = readCoordinatorRow("runtime");
    expect(row).toBeDefined();
    const alias = join(root, "suspension-guard-hardlink.sqlite");
    await link(row!.guard_path, alias);
    try {
      expect(() =>
        suspendRuntimeStorageAdmission(runtimeLeaseInputsForConfig(config)),
      ).toThrow(/owner-only regular file/);
    } finally {
      await rm(alias, { force: true });
    }
    expect(() => lease.assertCovers(runtimeLeaseInputsForConfig(config))).toThrow(
      /storage admission is suspended/,
    );
    lease.release();
  });

  it("retains its guard when the exact coordinator row is missing", async () => {
    const { config } = await createRuntimeConfig();
    const lease = acquireRuntimeProcessLease(config);
    const row = readCoordinatorRow("runtime");
    expect(row).toBeDefined();
    deleteCoordinatorRow(row!.lease_id);

    expect(() => lease.release()).toThrow(/lost its exact lease row/);
    await expectRuntimeRejected(config, /guard with no coordinator row/);

    insertRawCoordinatorRow(row!);
    lease.release();
    const successor = acquireRuntimeProcessLease(config);
    successor.release();
  });

  it("retains its guard when its coordinator pointer is swapped", async () => {
    const { config } = await createRuntimeConfig();
    const lease = acquireRuntimeProcessLease(config);
    const row = readCoordinatorRow("runtime");
    expect(row).toBeDefined();
    const replacementId = randomUUID();
    const replacementPath = await createBoundGuard(replacementId, randomUUID());
    const database = new Database(resolveRuntimeLeaseCoordinatorPath());
    database
      .query("UPDATE coordinator_leases SET guard_path = ?1 WHERE lease_id = ?2")
      .run(replacementPath, row!.lease_id);
    database.close();

    try {
      expect(() => lease.release()).toThrow(/lost its exact lease row/);
      await expectRuntimeRejected(config, /guard path is not bound to its lease id/);
    } finally {
      const restore = new Database(resolveRuntimeLeaseCoordinatorPath());
      restore
        .query("UPDATE coordinator_leases SET guard_path = ?1 WHERE lease_id = ?2")
        .run(row!.guard_path, row!.lease_id);
      restore.close();
      await rm(replacementPath, { force: true });
    }
    lease.release();
  });

  it("retains its guard when the coordinator database is replaced", async () => {
    const { config } = await createRuntimeConfig();
    const lease = acquireRuntimeProcessLease(config);
    const coordinatorPath = resolveRuntimeLeaseCoordinatorPath();
    const originalPath = `${coordinatorPath}.original`;
    await rename(coordinatorPath, originalPath);
    await writeFile(coordinatorPath, "", { mode: 0o600 });
    try {
      expect(() => lease.release()).toThrow(/lost its exact lease row/);
      await expectRuntimeRejected(config, /guard with no coordinator row/);
    } finally {
      await rm(coordinatorPath, { force: true });
      await rename(originalPath, coordinatorPath);
    }
    lease.release();
  });

  it("retains and retries its authoritative guard when guard close fails", async () => {
    const { config } = await createRuntimeConfig();
    const lease = acquireRuntimeProcessLease(config);
    const row = readCoordinatorRow("runtime");
    expect(row).toBeDefined();
    const originalClose = Database.prototype.close;
    const close = vi.spyOn(Database.prototype, "close").mockImplementation(
      function injectedGuardCloseFailure(
        this: Database,
        ...args: Parameters<Database["close"]>
      ) {
        if (this.filename === row!.guard_path) {
          throw new Error("injected authoritative guard close failure");
        }
        return originalClose.apply(this, args);
      },
    );

    try {
      expect(() => lease.release()).toThrow(/authoritative guard close failure/);
      await expectRuntimeRejected(config, /guard with no coordinator row/);
    } finally {
      close.mockRestore();
    }

    lease.release();
    const successor = acquireRuntimeProcessLease(config);
    successor.release();
  });

  it("keeps production resolution env-independent and isolates Bun children only", async () => {
    const injected = resolveRuntimeLeaseCoordinatorPath();
    const originalHome = process.env.HOME;
    const originalTestPath = process.env.TRAUMA_TEST_RUNTIME_COORDINATOR_PATH;
    resetRuntimeLeaseCoordinatorPathForTesting();
    process.env.HOME = join(tmpdir(), "untrusted-home");
    process.env.TRAUMA_TEST_RUNTIME_COORDINATOR_PATH = join(
      tmpdir(),
      "untrusted-test-path",
      "coordinator.sqlite",
    );
    try {
      expect(resolveRuntimeLeaseCoordinatorPath()).toBe(
        join(
          userInfo().homedir,
          ".local",
          "state",
          "trauma",
          "runtime-leases",
          "coordinator.sqlite",
        ),
      );
      expect(resolveRuntimeLeaseCoordinatorPath()).toBe(
        resolveDefaultRuntimeLeaseCoordinatorPath(),
      );
    } finally {
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
      if (originalTestPath === undefined) {
        delete process.env.TRAUMA_TEST_RUNTIME_COORDINATOR_PATH;
      } else {
        process.env.TRAUMA_TEST_RUNTIME_COORDINATOR_PATH = originalTestPath;
      }
      setRuntimeLeaseCoordinatorPathForTesting(injected);
    }

    const unrelatedChildTemporaryRoot = await createTrackedTemporaryRoot();
    const bunOutput = execFileSync(
      process.execPath,
      [
        "-e",
        'import { resolveRuntimeLeaseCoordinatorPath } from "./src/server/runtime/process-lease.ts"; console.log(resolveRuntimeLeaseCoordinatorPath())',
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, TMPDIR: unrelatedChildTemporaryRoot },
      },
    ).trim();
    expect(bunOutput).toBe(injected);
    expect(
      execFileSync("node", ["-e", 'process.stdout.write("node-ok")'], {
        encoding: "utf8",
        env: process.env,
      }),
    ).toBe("node-ok");
  });

  it("rejects unsafe test coordinator injection parents", async () => {
    const injected = resolveRuntimeLeaseCoordinatorPath();
    const root = await createTrackedTemporaryRoot();
    const realParent = join(root, "real");
    const linkedParent = join(root, "linked");
    const permissiveParent = join(root, "permissive");
    await mkdir(realParent, { mode: 0o700 });
    await symlink(realParent, linkedParent, "dir");
    await mkdir(permissiveParent, { mode: 0o700 });
    await chmod(permissiveParent, 0o777);
    try {
      expect(() => setRuntimeLeaseCoordinatorPathForTesting("relative")).toThrow();
      expect(() =>
        setRuntimeLeaseCoordinatorPathForTesting(
          join(linkedParent, "coordinator.sqlite"),
        ),
      ).toThrow(/symbolic link/);
      expect(() =>
        setRuntimeLeaseCoordinatorPathForTesting(
          join(permissiveParent, "coordinator.sqlite"),
        ),
      ).toThrow(/owner-only/);
    } finally {
      setRuntimeLeaseCoordinatorPathForTesting(injected);
    }
  });
});
