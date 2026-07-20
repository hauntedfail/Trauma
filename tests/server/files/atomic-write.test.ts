import {
  access,
  chmod,
  link,
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
  AtomicFilePublicationUncertainError,
  createFileAtomically,
  publishFileAtomically,
  writeFileAtomically,
  type AtomicCreateFileSystem,
  type AtomicPublishFileSystem,
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

describe("durable atomic file publication", () => {
  it("syncs a new file before rename and syncs its parent directory", async () => {
    const root = await makeRoot();
    const targetPath = join(root, "TRANSLATION_MAP.json");
    const calls: string[] = [];
    const fileSystem = createInstrumentedPublishFileSystem({ calls });

    await publishFileAtomically(targetPath, "{}\n", { fileSystem });

    expect(await readFile(targetPath, "utf8")).toBe("{}\n");
    expect(calls).toEqual([
      "open-file",
      "write-file",
      "sync-file",
      "close-file",
      "rename",
      "open-directory",
      "sync-directory",
      "close-directory",
    ]);
  });

  it("rejects a real parent-directory sync failure", async () => {
    const root = await makeRoot();
    const targetPath = join(root, "CONTENT.md");
    const error = Object.assign(new Error("directory sync failed"), { code: "EIO" });

    const publication = publishFileAtomically(targetPath, "translated\n", {
      fileSystem: createInstrumentedPublishFileSystem({
        calls: [],
        directorySyncError: error,
      }),
    });

    await expect(publication).rejects.toMatchObject({
      cause: error,
      name: "AtomicFilePublicationUncertainError",
      targetPath,
    });
    await expect(publication).rejects.toBeInstanceOf(
      AtomicFilePublicationUncertainError,
    );
    expect(await readFile(targetPath, "utf8")).toBe("translated\n");
  });

  it("allows only an unsupported parent-directory sync operation", async () => {
    const root = await makeRoot();
    const targetPath = join(root, "CONTENT.md");
    const error = Object.assign(new Error("directory sync unsupported"), {
      code: "ENOTSUP",
    });

    await expect(
      publishFileAtomically(targetPath, "translated\n", {
        fileSystem: createInstrumentedPublishFileSystem({
          calls: [],
          directorySyncError: error,
        }),
      }),
    ).resolves.toBeUndefined();
  });
});

describe("durable atomic file creation", () => {
  it("syncs content before exclusive publication and the directory before success", async () => {
    const root = await makeRoot();
    const targetPath = join(root, "CONTENT.md");
    const calls: string[] = [];
    const fileSystem = createInstrumentedCreateFileSystem({ calls });

    await createFileAtomically(targetPath, "content\n", { fileSystem });

    expect(await readFile(targetPath, "utf8")).toBe("content\n");
    expect(calls).toEqual([
      "open-file",
      "write-file",
      "sync-file",
      "close-file",
      "link",
      "open-directory",
      "sync-directory",
      "close-directory",
      "remove-temporary",
    ]);
  });

  it("reports an ambiguous publication when directory durability fails after linking", async () => {
    const root = await makeRoot();
    const targetPath = join(root, "CONTENT.md");
    const error = Object.assign(new Error("directory sync failed"), {
      code: "EIO",
    });

    const result = await createFileAtomically(targetPath, "content\n", {
      fileSystem: createInstrumentedCreateFileSystem({
        calls: [],
        directorySyncError: error,
      }),
    }).catch((caught: unknown) => caught);

    expect(result).toMatchObject({
      name: "AtomicCreatePublicationError",
      targetPath,
    });
    expect(result).toHaveProperty("cause", error);
    expect(await readFile(targetPath, "utf8")).toBe("content\n");
  });

  it("preserves an existing target when exclusive publication collides", async () => {
    const root = await makeRoot();
    const targetPath = join(root, "CONTENT.md");
    await writeFile(targetPath, "original\n", "utf8");

    await expect(createFileAtomically(targetPath, "replacement\n"))
      .rejects.toMatchObject({ code: "EEXIST" });

    expect(await readFile(targetPath, "utf8")).toBe("original\n");
  });

  it("propagates a pre-publication cross-device link failure without ambiguity", async () => {
    const root = await makeRoot();
    const targetPath = join(root, "CONTENT.md");
    const calls: string[] = [];
    const error = Object.assign(new Error("cross-device link"), {
      code: "EXDEV",
    });

    await expect(
      createFileAtomically(targetPath, "content\n", {
        fileSystem: createInstrumentedCreateFileSystem({
          calls,
          linkError: error,
        }),
      }),
    ).rejects.toBe(error);

    await expect(access(targetPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(calls.at(-1)).toBe("remove-temporary");
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

function createInstrumentedCreateFileSystem(input: {
  calls: string[];
  directorySyncError?: Error;
  linkError?: Error;
}): AtomicCreateFileSystem {
  return {
    link: async (source, destination) => {
      input.calls.push("link");
      if (input.linkError !== undefined) {
        throw input.linkError;
      }
      await link(source, destination);
    },
    open: async (path, flags, mode) => {
      input.calls.push("open-file");
      const handle = await open(path, flags, mode);
      return {
        writeFile: async (data, options) => {
          input.calls.push("write-file");
          await handle.writeFile(data, options);
        },
        sync: async () => {
          input.calls.push("sync-file");
          await handle.sync();
        },
        close: async () => {
          input.calls.push("close-file");
          await handle.close();
        },
      };
    },
    openDirectory: async (path) => {
      input.calls.push("open-directory");
      const handle = await open(path, "r");
      return {
        sync: async () => {
          input.calls.push("sync-directory");
          if (input.directorySyncError !== undefined) {
            throw input.directorySyncError;
          }
          await handle.sync();
        },
        close: async () => {
          input.calls.push("close-directory");
          await handle.close();
        },
      };
    },
    rm: async (path, options) => {
      input.calls.push("remove-temporary");
      await rm(path, options);
    },
  };
}

function createInstrumentedPublishFileSystem(input: {
  calls: string[];
  directorySyncError?: Error;
}): AtomicPublishFileSystem {
  return {
    open: async (path, flags, mode) => {
      input.calls.push("open-file");
      const handle = await open(path, flags, mode);
      return {
        writeFile: async (data, options) => {
          input.calls.push("write-file");
          await handle.writeFile(data, options);
        },
        sync: async () => {
          input.calls.push("sync-file");
          await handle.sync();
        },
        close: async () => {
          input.calls.push("close-file");
          await handle.close();
        },
      };
    },
    rename: async (source, destination) => {
      input.calls.push("rename");
      await import("node:fs/promises").then((module) =>
        module.rename(source, destination)
      );
    },
    openDirectory: async (path) => {
      input.calls.push("open-directory");
      const handle = await open(path, "r");
      return {
        sync: async () => {
          input.calls.push("sync-directory");
          if (input.directorySyncError !== undefined) {
            throw input.directorySyncError;
          }
          await handle.sync();
        },
        close: async () => {
          input.calls.push("close-directory");
          await handle.close();
        },
      };
    },
    rm: (path, options) => rm(path, options),
  };
}
