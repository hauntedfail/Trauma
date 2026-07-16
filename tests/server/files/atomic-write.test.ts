import {
  access,
  chmod,
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  writeFileAtomically,
  type AtomicWriteFileSystem,
} from "../../../src/server/files/atomic-write";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

describe("durable atomic file replacement", () => {
  it("syncs the temporary file before same-directory rename", async () => {
    const root = await makeRoot();
    const targetPath = join(root, "trauma.config.json");
    await writeFile(targetPath, "old\n", "utf8");
    await chmod(targetPath, 0o600);
    const calls: string[] = [];
    let temporaryPath = "";
    const fileSystem = createInstrumentedFileSystem({
      onOpen: (path) => {
        temporaryPath = path;
        calls.push("open");
      },
      onSync: () => calls.push("sync"),
      onClose: () => calls.push("close"),
      onRename: (source, destination) => {
        calls.push("rename");
        expect(dirname(source)).toBe(dirname(destination));
      },
    });

    await writeFileAtomically(targetPath, "new\n", { fileSystem });

    expect(await readFile(targetPath, "utf8")).toBe("new\n");
    expect((await stat(targetPath)).mode & 0o777).toBe(0o600);
    expect(calls.slice(0, 4)).toEqual(["open", "sync", "close", "rename"]);
    await expect(access(temporaryPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the original file and removes the temporary file when rename fails", async () => {
    const root = await makeRoot();
    const targetPath = join(root, "trauma.config.json");
    await writeFile(targetPath, "old\n", "utf8");
    let temporaryPath = "";
    const fileSystem = createInstrumentedFileSystem({
      onOpen: (path) => {
        temporaryPath = path;
      },
      renameError: new Error("rename failed"),
    });

    await expect(
      writeFileAtomically(targetPath, "new\n", { fileSystem }),
    ).rejects.toThrow("rename failed");

    expect(await readFile(targetPath, "utf8")).toBe("old\n");
    await expect(access(temporaryPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the original file when the temporary file cannot be synced", async () => {
    const root = await makeRoot();
    const targetPath = join(root, "trauma.config.json");
    await writeFile(targetPath, "old\n", "utf8");
    let temporaryPath = "";
    const fileSystem = createInstrumentedFileSystem({
      onOpen: (path) => {
        temporaryPath = path;
      },
      syncError: new Error("sync failed"),
    });

    await expect(
      writeFileAtomically(targetPath, "new\n", { fileSystem }),
    ).rejects.toThrow("sync failed");

    expect(await readFile(targetPath, "utf8")).toBe("old\n");
    await expect(access(temporaryPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

async function makeRoot() {
  const root = await mkdtemp(join(tmpdir(), "trauma-atomic-write-"));
  tempDirs.push(root);
  return root;
}

function createInstrumentedFileSystem(input: {
  onClose?: () => void;
  onOpen?: (path: string) => void;
  onRename?: (source: string, destination: string) => void;
  onSync?: () => void;
  renameError?: Error;
  syncError?: Error;
}): AtomicWriteFileSystem {
  return {
    open: async (path, flags, mode) => {
      input.onOpen?.(path);
      const handle = await open(path, flags, mode);
      return {
        writeFile: (data, options) => handle.writeFile(data, options),
        sync: async () => {
          if (input.syncError !== undefined) {
            throw input.syncError;
          }
          await handle.sync();
          input.onSync?.();
        },
        close: async () => {
          await handle.close();
          input.onClose?.();
        },
      };
    },
    rename: async (source, destination) => {
      input.onRename?.(source, destination);
      if (input.renameError !== undefined) {
        throw input.renameError;
      }
      await import("node:fs/promises").then((module) =>
        module.rename(source, destination)
      );
    },
    openDirectory: async (path) => {
      const handle = await open(path, "r");
      return {
        sync: () => handle.sync(),
        close: () => handle.close(),
      };
    },
    rm: (path, options) => rm(path, options),
    stat: (path) => import("node:fs/promises").then((module) => module.stat(path)),
  };
}
