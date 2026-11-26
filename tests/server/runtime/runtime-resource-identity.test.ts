import { realpathSync } from "node:fs";
import { link, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ResolvedTraumaConfig } from "../../../src/server/config";
import {
  acquireRuntimeResourceLeases,
  ensureRuntimeProcessLease,
  resolveRuntimeProcessLeasePaths,
  runtimeLeaseInputsForConfig,
} from "../../../src/server/runtime/process-lease";
import {
  normalizeRuntimePathSegment,
  resolveRuntimeResourceLeasePlan,
} from "../../../src/server/runtime/runtime-resource-identity";
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

  describe("hardlink-stable canonicalization", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("keeps missing-lease coverage and rejects hardlink aliases when realpath reports the alias", async () => {
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

      const originalRealpath = realpathSync.native;
      const primaryRealPath = join(
        originalRealpath(firstDirectory),
        "database.sqlite",
      );
      const aliasRealPath = join(
        originalRealpath(aliasDirectory),
        "database.sqlite",
      );
      spyRealpathNativeRewrites(
        new Map([
          [resolve(primary), aliasRealPath],
          [primaryRealPath, aliasRealPath],
        ]),
      );

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

    it("rejects a parent-directory contender for an existing hardlink when realpath reports the alias", async () => {
      const { config, root } = await createRuntimeConfig();
      const primaryDirectory = join(root, "primary-view");
      const aliasDirectory = join(root, "alias-view");
      await mkdir(primaryDirectory);
      await mkdir(aliasDirectory);
      const primary = join(primaryDirectory, "database.sqlite");
      const alias = join(aliasDirectory, "database.sqlite");
      await writeFile(primary, "");
      await link(primary, alias);

      const originalRealpath = realpathSync.native;
      const primaryRealPath = join(
        originalRealpath(primaryDirectory),
        "database.sqlite",
      );
      const aliasRealPath = join(
        originalRealpath(aliasDirectory),
        "database.sqlite",
      );
      spyRealpathNativeRewrites(
        new Map([
          [resolve(primary), aliasRealPath],
          [primaryRealPath, aliasRealPath],
        ]),
      );

      const lease = acquireRuntimeResourceLeases([
        { resourceLabel: "databasePath", resourcePath: primary },
      ]);
      const contender = {
        ...config,
        databasePath: join(root, "other.sqlite"),
        projectPath: primaryDirectory,
        storePath: join(primaryDirectory, "store"),
      };
      await expectRuntimeRejected(contender, /projectPath=/);
      lease.release();
    });

    it("rejects a target parent-directory contender for a symlink to a hardlink when realpath reports the alias", async () => {
      const { config, root } = await createRuntimeConfig();
      const primaryDirectory = join(root, "primary-view");
      const aliasDirectory = join(root, "alias-view");
      const linkDirectory = join(root, "link-view");
      await mkdir(primaryDirectory);
      await mkdir(aliasDirectory);
      await mkdir(linkDirectory);
      const primary = join(primaryDirectory, "database.sqlite");
      const alias = join(aliasDirectory, "database.sqlite");
      const fileLink = join(linkDirectory, "database-link.sqlite");
      await writeFile(primary, "");
      await link(primary, alias);
      await symlink("../primary-view/database.sqlite", fileLink);

      const originalRealpath = realpathSync.native;
      const primaryRealPath = join(
        originalRealpath(primaryDirectory),
        "database.sqlite",
      );
      const fileLinkRealParentPath = join(
        originalRealpath(linkDirectory),
        "database-link.sqlite",
      );
      const aliasRealPath = join(
        originalRealpath(aliasDirectory),
        "database.sqlite",
      );
      spyRealpathNativeRewrites(
        new Map([
          [resolve(fileLink), aliasRealPath],
          [fileLinkRealParentPath, aliasRealPath],
          [resolve(primary), aliasRealPath],
          [primaryRealPath, aliasRealPath],
        ]),
      );

      const lease = acquireRuntimeResourceLeases([
        { resourceLabel: "databasePath", resourcePath: fileLink },
      ]);
      const parentContender = {
        ...config,
        databasePath: join(root, "other.sqlite"),
        projectPath: primaryDirectory,
        storePath: join(primaryDirectory, "store"),
      };
      await expectRuntimeRejected(parentContender, /projectPath=/);

      const aliasContender = {
        ...config,
        databasePath: alias,
        projectPath: join(root, "other-project"),
        storePath: join(root, "other-project", "store"),
      };
      await expectRuntimeRejected(aliasContender, /databasePath=/);
      lease.release();
    });

    it("produces the same plan identity when realpath reports different hardlink names", async () => {
      const { root } = await createRuntimeConfig();
      const primaryDirectory = join(root, "primary-view");
      const aliasDirectory = join(root, "alias-view");
      await mkdir(primaryDirectory);
      await mkdir(aliasDirectory);
      const primary = join(primaryDirectory, "database.sqlite");
      const alias = join(aliasDirectory, "database.sqlite");
      await writeFile(primary, "");
      await link(primary, alias);

      const originalRealpath = realpathSync.native;
      const primaryRealPath = join(
        originalRealpath(primaryDirectory),
        "database.sqlite",
      );
      const aliasRealPath = join(
        originalRealpath(aliasDirectory),
        "database.sqlite",
      );

      const primarySpy = spyRealpathNativeRewrites(
        new Map([
          [resolve(primary), primaryRealPath],
          [primaryRealPath, primaryRealPath],
        ]),
      );
      const planFromPrimary = resolveRuntimeResourceLeasePlan([
        { resourceLabel: "databasePath", resourcePath: primary },
      ]);
      primarySpy.mockRestore();

      spyRealpathNativeRewrites(
        new Map([
          [resolve(primary), aliasRealPath],
          [primaryRealPath, aliasRealPath],
        ]),
      );
      const planFromAlias = resolveRuntimeResourceLeasePlan([
        { resourceLabel: "databasePath", resourcePath: primary },
      ]);

      expect(planFromAlias.identity).toBe(planFromPrimary.identity);
      expect(planFromAlias.rootSet).toBe(planFromPrimary.rootSet);
      expect(planFromAlias.resources).toEqual(planFromPrimary.resources);
      expect(planFromAlias.resources[0]?.resourcePath).toBe(primaryRealPath);
    });

    it("follows relative symlink chains to hardlinks while failing closed on loops and chained dangling symlinks", async () => {
      const { root } = await createRuntimeConfig();
      const primaryDirectory = join(root, "primary-view");
      const aliasDirectory = join(root, "alias-view");
      const firstHopDirectory = join(root, "hop-one");
      const secondHopDirectory = join(root, "hop-two");
      await mkdir(primaryDirectory);
      await mkdir(aliasDirectory);
      await mkdir(firstHopDirectory);
      await mkdir(secondHopDirectory);

      const primary = join(primaryDirectory, "database.sqlite");
      const alias = join(aliasDirectory, "database.sqlite");
      const hopTwo = join(secondHopDirectory, "step-two.sqlite");
      const hopOne = join(firstHopDirectory, "step-one.sqlite");
      await writeFile(primary, "");
      await link(primary, alias);
      await symlink("../primary-view/database.sqlite", hopTwo);
      await symlink("../hop-two/step-two.sqlite", hopOne);

      const originalRealpath = realpathSync.native;
      const primaryRealPath = join(
        originalRealpath(primaryDirectory),
        "database.sqlite",
      );
      const aliasRealPath = join(
        originalRealpath(aliasDirectory),
        "database.sqlite",
      );
      spyRealpathNativeRewrites(
        new Map([
          [resolve(hopOne), aliasRealPath],
          [resolve(hopTwo), aliasRealPath],
          [resolve(primary), aliasRealPath],
          [primaryRealPath, aliasRealPath],
        ]),
      );

      const chainedPlan = resolveRuntimeResourceLeasePlan([
        { resourceLabel: "databasePath", resourcePath: hopOne },
      ]);
      const directPlan = resolveRuntimeResourceLeasePlan([
        { resourceLabel: "databasePath", resourcePath: primary },
      ]);
      expect(chainedPlan.identity).toBe(directPlan.identity);
      expect(chainedPlan.resources[0]?.resourcePath).toBe(primaryRealPath);

      const danglingTarget = join(secondHopDirectory, "dangling-hop");
      const danglingEntry = join(firstHopDirectory, "dangling-start");
      await symlink("../missing.sqlite", danglingTarget);
      await symlink("../hop-two/dangling-hop", danglingEntry);
      expect(() =>
        resolveRuntimeResourceLeasePlan([
          { resourceLabel: "databasePath", resourcePath: danglingEntry },
        ])
      ).toThrow(/dangling symbolic link/);

      const loopA = join(firstHopDirectory, "loop-a");
      const loopB = join(firstHopDirectory, "loop-b");
      await symlink("loop-b", loopA);
      await symlink("loop-a", loopB);
      expect(() =>
        resolveRuntimeResourceLeasePlan([
          { resourceLabel: "databasePath", resourcePath: loopA },
        ])
      ).toThrow(/Failed to canonicalize runtime resource/);
    });

    it("preserves on-disk leaf spelling on case-folding platforms independently of realpath", async () => {
      if (process.platform !== "darwin" && process.platform !== "win32") {
        return;
      }
      const { root } = await createRuntimeConfig();
      const primaryDirectory = join(root, "primary-view");
      const aliasDirectory = join(root, "alias-view");
      await mkdir(primaryDirectory);
      await mkdir(aliasDirectory);
      const primaryOnDisk = join(primaryDirectory, "Database.sqlite");
      const primaryLower = join(primaryDirectory, "database.sqlite");
      const alias = join(aliasDirectory, "Alias.sqlite");
      await writeFile(primaryOnDisk, "");
      await link(primaryOnDisk, alias);

      const originalRealpath = realpathSync.native;
      const primaryRealPath = join(
        originalRealpath(primaryDirectory),
        "Database.sqlite",
      );
      const aliasRealPath = join(
        originalRealpath(aliasDirectory),
        "Alias.sqlite",
      );

      const primarySpy = spyRealpathNativeRewrites(
        new Map([
          [resolve(primaryLower), primaryRealPath],
          [resolve(primaryOnDisk), primaryRealPath],
          [primaryRealPath, primaryRealPath],
        ]),
      );
      const planFromPrimary = resolveRuntimeResourceLeasePlan([
        { resourceLabel: "databasePath", resourcePath: primaryLower },
      ]);
      primarySpy.mockRestore();

      spyRealpathNativeRewrites(
        new Map([
          [resolve(primaryLower), aliasRealPath],
          [resolve(primaryOnDisk), aliasRealPath],
          [primaryRealPath, aliasRealPath],
        ]),
      );
      const planFromAlias = resolveRuntimeResourceLeasePlan([
        { resourceLabel: "databasePath", resourcePath: primaryLower },
      ]);

      expect(planFromAlias.identity).toBe(planFromPrimary.identity);
      expect(planFromAlias.resources[0]?.resourcePath).toBe(primaryRealPath);
    });
  });
});

function spyRealpathNativeRewrites(rewrites: ReadonlyMap<string, string>) {
  const originalRealpath = realpathSync.native;
  return vi.spyOn(realpathSync, "native").mockImplementation(((
    target: Parameters<typeof realpathSync.native>[0],
    options?: Parameters<typeof realpathSync.native>[1],
  ) => {
    const key = typeof target === "string" ? target : target.toString();
    const rewritten = rewrites.get(key);
    if (rewritten !== undefined) {
      return rewritten;
    }
    return originalRealpath(target, options);
  }) as typeof realpathSync.native);
}
