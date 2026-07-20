import { link, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ResolvedTraumaConfig } from "../../../src/server/config";
import {
  acquireRuntimeResourceLeases,
  ensureRuntimeProcessLease,
  resolveRuntimeProcessLeasePaths,
  runtimeLeaseInputsForConfig,
} from "../../../src/server/runtime/process-lease";
import { normalizeRuntimePathSegment } from "../../../src/server/runtime/runtime-resource-identity";
import {
  createRuntimeConfig,
  expectRuntimeRejected,
  releaseLeaseOwner,
  startLeaseOwner,
} from "./runtime-lease-test-helpers";

describe("runtime resource identity", () => {
  it("reserves every SQLite sidecar name as part of the database family", async () => {
    const { config, root } = await createRuntimeConfig();
    const owner = await startLeaseOwner(config);
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      const contender: ResolvedTraumaConfig = {
        ...config,
        configFilePath: join(root, `${suffix.slice(1)}.config.json`),
        databasePath: `${config.databasePath}${suffix}`,
        projectPath: join(root, `project-${suffix.slice(1)}`),
        storePath: join(root, `project-${suffix.slice(1)}`, "store"),
      };
      await expectRuntimeRejected(contender, /databasePath=/);
    }
    await releaseLeaseOwner(owner);
  });

  it("full-folds non-ASCII missing aliases on case-folding platforms", async () => {
    if (process.platform !== "darwin" && process.platform !== "win32") {
      return;
    }
    const { config, root } = await createRuntimeConfig();
    for (const [heldName, aliasName] of [
      ["straße", "STRASSE"],
      ["ẞ", "SS"],
    ] as const) {
      const held: ResolvedTraumaConfig = {
        ...config,
        databasePath: join(root, `db-${heldName}.sqlite`),
        projectPath: join(root, heldName),
        storePath: join(root, heldName, "store"),
      };
      const alias: ResolvedTraumaConfig = {
        ...config,
        databasePath: join(root, `alias-${heldName}.sqlite`),
        projectPath: join(root, aliasName),
        storePath: join(root, aliasName, "store"),
      };
      const owner = await startLeaseOwner(held);
      await expectRuntimeRejected(alias, /projectPath=|storePath=/);
      await releaseLeaseOwner(owner);
    }
  });

  it("keeps NFC and NFD siblings distinct on Linux", async () => {
    if (process.platform !== "linux") {
      return;
    }
    const { root } = await createRuntimeConfig();
    const nfd = join(root, "e\u0301-project");
    const nfc = join(root, "é-project");
    const first = acquireRuntimeResourceLeases([
      { resourceLabel: "projectPath", resourcePath: nfd },
    ]);
    const second = acquireRuntimeResourceLeases([
      { resourceLabel: "projectPath", resourcePath: nfc },
    ]);
    expect(first.resources[0]?.resourcePath).toBe(nfd);
    expect(second.resources[0]?.resourcePath).toBe(nfc);
    second.release();
    first.release();
  });

  it("accepts POSIX path segments containing a backslash", async () => {
    if (process.platform === "win32") {
      return;
    }
    const { root } = await createRuntimeConfig();
    const path = join(root, "project\\name");
    const lease = acquireRuntimeResourceLeases([
      { resourceLabel: "projectPath", resourcePath: path },
    ]);
    expect(lease.resources[0]?.resourcePath).toMatch(/\/project\\name$/u);
    lease.release();
  });

  it("rejects ambiguous Windows suffix spellings in the pure normalizer", () => {
    expect(() => normalizeRuntimePathSegment("db.sqlite.", "win32")).toThrow(
      /ambiguous/,
    );
    expect(() => normalizeRuntimePathSegment("db.sqlite ", "win32")).toThrow(
      /ambiguous/,
    );
    expect(() => normalizeRuntimePathSegment("file:stream", "win32")).toThrow(
      /ambiguous/,
    );
    expect(normalizeRuntimePathSegment("ẞ", "win32")).toBe("ss");
  });

  it("fails closed on final and intermediate dangling symlinks", async () => {
    const { config, root } = await createRuntimeConfig();
    const target = join(root, "missing-target");
    const finalLink = join(root, "dangling-project");
    await symlink(target, finalLink, "dir");
    expect(() =>
      resolveRuntimeProcessLeasePaths({
        ...config,
        projectPath: finalLink,
        storePath: join(finalLink, "store"),
      })
    ).toThrow(/dangling symbolic link/);

    const container = join(root, "container");
    await mkdir(container);
    const intermediate = join(container, "dangling");
    await symlink(target, intermediate, "dir");
    expect(() =>
      resolveRuntimeProcessLeasePaths({
        ...config,
        projectPath: join(intermediate, "project"),
        storePath: join(intermediate, "project", "store"),
      })
    ).toThrow(/dangling symbolic link/);
  });

  it("re-canonicalizes coverage after a configured symlink is retargeted", async () => {
    const { config, root } = await createRuntimeConfig();
    const firstTarget = join(root, "first-target");
    const secondTarget = join(root, "second-target");
    const alias = join(root, "active-project");
    await mkdir(join(firstTarget, "store"), { recursive: true });
    await mkdir(join(secondTarget, "store"), { recursive: true });
    await symlink(firstTarget, alias, "dir");
    const linkedConfig = {
      ...config,
      projectPath: alias,
      storePath: join(alias, "store"),
    };
    const lease = ensureRuntimeProcessLease(linkedConfig);
    await rm(alias);
    await symlink(secondTarget, alias, "dir");
    expect(() =>
      lease.assertCovers(runtimeLeaseInputsForConfig(linkedConfig))
    ).toThrow(/configuration changed/);
    lease.release();
  });

  it("retains every hardlink presentation identity when resources deduplicate", async () => {
    const { config, root } = await createRuntimeConfig();
    const firstDirectory = join(root, "first-view");
    const secondDirectory = join(root, "second-view");
    await mkdir(firstDirectory);
    await mkdir(secondDirectory);
    const first = join(firstDirectory, "shared.sqlite");
    const second = join(secondDirectory, "shared.sqlite");
    await writeFile(first, "");
    await link(first, second);
    const lease = acquireRuntimeResourceLeases([
      { resourceLabel: "first", resourcePath: first },
      { resourceLabel: "second", resourcePath: second },
    ]);
    const contender = {
      ...config,
      databasePath: join(root, "other.sqlite"),
      projectPath: secondDirectory,
      storePath: join(secondDirectory, "store"),
    };
    await expectRuntimeRejected(contender, /projectPath=/);
    lease.release();
  });

  it("enriches a missing lease with its materialized inode identity", async () => {
    const { config, root } = await createRuntimeConfig();
    const firstDirectory = join(root, "materialized");
    const aliasDirectory = join(root, "alias-view");
    await mkdir(firstDirectory);
    await mkdir(aliasDirectory);
    const primary = join(firstDirectory, "database.sqlite");
    const alias = join(aliasDirectory, "database.sqlite");
    const lease = acquireRuntimeResourceLeases([
      { resourceLabel: "databasePath", resourcePath: primary },
    ]);
    await writeFile(primary, "");
    await link(primary, alias);
    lease.assertCovers([
      { resourceLabel: "databasePath", resourcePath: primary },
    ]);
    const contender = {
      ...config,
      databasePath: alias,
      projectPath: join(root, "other-project"),
      storePath: join(root, "other-project", "store"),
    };
    await expectRuntimeRejected(contender, /databasePath=/);
    lease.release();
  });
});
