import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdtemp,
  mkdir,
  open,
  readFile,
  realpath,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  BackupFailsafeMigrationConflictError,
  copyBackupFailsafeMigrationFile,
  type BackupFailsafeMigrationFileSystem,
} from "../../../src/server/backup/failsafe-migration-file";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    ),
  );
});

describe("backup failsafe migration file publication", () => {
  it("does not expose a final file when no-overwrite publication fails", async () => {
    const root = await makeRoot();
    const source = join(root, "source/CONTENT.md");
    const destination = join(root, "target/CONTENT.md");
    await mkdir(dirname(source), { recursive: true });
    await writeFile(source, "# complete source\n", "utf8");
    let inspectedTemporaryFile = false;
    const fileSystem = createFileSystem({
      link: async (temporaryPath, finalPath) => {
        await expect(readFile(finalPath, "utf8")).rejects.toMatchObject({
          code: "ENOENT",
        });
        await expect(readFile(temporaryPath, "utf8")).resolves.toBe(
          "# complete source\n",
        );
        inspectedTemporaryFile = true;
        throw new Error("publication interrupted");
      },
    });

    await expect(
      copyBackupFailsafeMigrationFile(source, destination, { fileSystem }),
    ).rejects.toThrow("publication interrupted");

    expect(inspectedTemporaryFile).toBe(true);
    await expect(readFile(destination, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readdir(dirname(destination))).toEqual([]);
  });

  it("removes only the exact owner crash remnant before retrying publication", async () => {
    const root = await makeRoot();
    const source = join(root, "source/CONTENT.md");
    const destination = join(root, "target/CONTENT.md");
    await mkdir(dirname(source), { recursive: true });
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(source, "# complete source\n", "utf8");
    const ownedTemporary = join(
      dirname(destination),
      ".CONTENT.md.trauma-failsafe-migrate.owner-1.tmp",
    );
    const unrelatedTemporary = join(
      dirname(destination),
      ".CONTENT.md.trauma-failsafe-migrate.unrelated.tmp",
    );
    await writeFile(
      ownedTemporary,
      "# partial\n",
      "utf8",
    );
    await writeFile(unrelatedTemporary, "# another operation\n", "utf8");

    await copyBackupFailsafeMigrationFile(source, destination, {
      ownerToken: "owner-1",
      targetRoot: join(root, "target"),
    });

    await expect(readFile(destination, "utf8")).resolves.toBe(
      "# complete source\n",
    );
    expect((await readdir(dirname(destination))).sort()).toEqual([
      ".CONTENT.md.trauma-failsafe-migrate.unrelated.tmp",
      "CONTENT.md",
    ]);
  });

  it("rejects an existing symlink even when it resolves to matching bytes", async () => {
    const root = await makeRoot();
    const source = join(root, "source/CONTENT.md");
    const destination = join(root, "target/CONTENT.md");
    await mkdir(dirname(source), { recursive: true });
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(source, "# complete source\n", "utf8");
    await symlink(source, destination);

    await expect(
      copyBackupFailsafeMigrationFile(source, destination),
    ).rejects.toBeInstanceOf(BackupFailsafeMigrationConflictError);
  });

  it("rejects a symlink source instead of copying its target", async () => {
    const root = await makeRoot();
    const realSource = join(root, "outside.md");
    const source = join(root, "source/CONTENT.md");
    const targetRoot = join(root, "target");
    const destination = join(targetRoot, "store/CONTENT.md");
    await mkdir(dirname(source), { recursive: true });
    await writeFile(realSource, "# outside\n", "utf8");
    await symlink(realSource, source);

    await expect(
      copyBackupFailsafeMigrationFile(source, destination, { targetRoot }),
    ).rejects.toThrow(/unsafe backup migration source/);
  });

  it("rejects symlink and non-directory destination path components", async () => {
    const root = await makeRoot();
    const source = join(root, "source/CONTENT.md");
    const targetRoot = join(root, "target");
    const realDirectory = join(root, "redirected");
    await mkdir(dirname(source), { recursive: true });
    await mkdir(targetRoot, { recursive: true });
    await mkdir(realDirectory, { recursive: true });
    await writeFile(source, "# complete source\n", "utf8");
    await symlink(realDirectory, join(targetRoot, "symlinked"));
    await writeFile(join(targetRoot, "regular"), "not a directory", "utf8");

    await expect(
      copyBackupFailsafeMigrationFile(
        source,
        join(targetRoot, "symlinked/CONTENT.md"),
        { ownerToken: "owner-1", targetRoot },
      ),
    ).rejects.toThrow(/unsafe destination path component/);
    await expect(
      copyBackupFailsafeMigrationFile(
        source,
        join(targetRoot, "regular/CONTENT.md"),
        { ownerToken: "owner-1", targetRoot },
      ),
    ).rejects.toThrow(/unsafe destination path component/);
    await expect(readFile(join(realDirectory, "CONTENT.md"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("opens a copied read-only snapshot without requesting write access", async () => {
    const root = await makeRoot();
    const source = join(root, "source/CONTENT.md");
    const targetRoot = join(root, "target");
    const destination = join(targetRoot, "CONTENT.md");
    await mkdir(dirname(source), { recursive: true });
    await writeFile(source, "# read only\n", "utf8");
    await chmod(source, 0o444);
    const openFlags: string[] = [];
    const fileSystem = createFileSystem({
      openForSync: (path) => {
        openFlags.push("r");
        return open(path, "r");
      },
    });

    await copyBackupFailsafeMigrationFile(source, destination, {
      fileSystem,
      ownerToken: "owner-1",
      targetRoot,
    });

    expect(openFlags).toEqual(["r"]);
    await expect(readFile(destination, "utf8")).resolves.toBe("# read only\n");
  });

  it("compares an EEXIST target with the synced snapshot, not a mutable source", async () => {
    const root = await makeRoot();
    const source = join(root, "source/CONTENT.md");
    const targetRoot = join(root, "target");
    const destination = join(targetRoot, "CONTENT.md");
    await mkdir(dirname(source), { recursive: true });
    await mkdir(targetRoot, { recursive: true });
    await writeFile(source, "# approved snapshot\n", "utf8");
    await writeFile(destination, "# approved snapshot\n", "utf8");
    const fileSystem = createFileSystem({
      link: async (snapshot, finalPath) => {
        await writeFile(source, "# source changed\n", "utf8");
        await link(snapshot, finalPath);
      },
    });

    await expect(
      copyBackupFailsafeMigrationFile(source, destination, {
        fileSystem,
        ownerToken: "owner-1",
        targetRoot,
      }),
    ).resolves.toBeUndefined();
    await expect(readFile(destination, "utf8")).resolves.toBe(
      "# approved snapshot\n",
    );
  });

  it("re-checks canonical containment immediately before publication", async () => {
    const root = await makeRoot();
    const source = join(root, "source/CONTENT.md");
    const targetRoot = join(root, "target");
    const destination = join(targetRoot, "nested/CONTENT.md");
    const targetDirectory = dirname(destination);
    await mkdir(dirname(source), { recursive: true });
    await writeFile(source, "# approved snapshot\n", "utf8");
    let directoryRealpathReads = 0;
    let publicationAttempted = false;
    const fileSystem = createFileSystem({
      realpath: async (path) => {
        if (path === targetDirectory && ++directoryRealpathReads === 2) {
          return join(root, "escaped");
        }
        return realpath(path);
      },
      link: async (snapshot, finalPath) => {
        publicationAttempted = true;
        await link(snapshot, finalPath);
      },
    });

    await expect(
      copyBackupFailsafeMigrationFile(source, destination, {
        fileSystem,
        ownerToken: "owner-1",
        targetRoot,
      }),
    ).rejects.toThrow(/escaped targetRoot/);
    expect(publicationAttempted).toBe(false);
  });
});

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), "trauma-failsafe-migration-file-"));
  tempDirs.push(root);
  return root;
}

function createFileSystem(
  overrides: Partial<BackupFailsafeMigrationFileSystem> = {},
): BackupFailsafeMigrationFileSystem {
  return {
    copyFile,
    link,
    lstat,
    mkdir,
    openDirectory: (path) => open(path, "r"),
    openForSync: (path) => open(path, "r"),
    readFile,
    realpath,
    remove: (path, options) => rm(path, options),
    ...overrides,
  };
}
