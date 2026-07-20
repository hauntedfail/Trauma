import {
  access,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getSourceFlashbackMetadataExportPath,
  writeFlashbackMetadataExport,
} from "../../../src/server/flashbacks/export";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

describe("durable Flashback metadata export", () => {
  it("syncs a newly created directory hierarchy and file before accepting publication", async () => {
    const root = await makeRoot();
    const storePath = join(root, "store");
    const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f411";
    const calls: string[] = [];
    const fileSystem = instrumentedFileSystem({ calls, root });
    const input = {
      config: { storePath },
      fileSystem,
      flashbacks: [{
        id: "flashback-b",
        memoryId,
        text: "beta",
        prefix: "alpha ",
        suffix: " gamma",
        startOffset: 6,
        endOffset: 10,
        contentHash: `sha256:${"a".repeat(64)}`,
        createdAt: new Date("2026-05-10T00:00:00.000Z"),
        updatedAt: new Date("2026-05-10T01:00:00.000Z"),
      }],
      memoryId,
      variant: {
        kind: "translation",
        langCode: "ja-JP",
        outputHash: `sha256:${"b".repeat(64)}`,
      } as const,
    };

    const relativePath = await writeFlashbackMetadataExport(input);

    expect(relativePath).toBe(
      `memories/${memoryId}/ja-JP/FLASHBACKS.json`,
    );
    expect(calls).toEqual([
      "mkdir:store/memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f411/ja-JP",
      "open-directory:.",
      "sync-directory:.",
      "close-directory:.",
      "open-directory:store",
      "sync-directory:store",
      "close-directory:store",
      "open-directory:store/memories",
      "sync-directory:store/memories",
      "close-directory:store/memories",
      `open-directory:store/memories/${memoryId}`,
      `sync-directory:store/memories/${memoryId}`,
      `close-directory:store/memories/${memoryId}`,
      "open-file",
      "write-file",
      "sync-file",
      "close-file",
      "rename",
      `open-directory:store/memories/${memoryId}/ja-JP`,
      `sync-directory:store/memories/${memoryId}/ja-JP`,
      `close-directory:store/memories/${memoryId}/ja-JP`,
    ]);
    expect(
      await readFile(join(storePath, relativePath), "utf8"),
    ).toBe(`${JSON.stringify({
      version: 2,
      memoryId,
      variant: {
        kind: "translation",
        langCode: "ja-JP",
        translationOutputHash: `sha256:${"b".repeat(64)}`,
      },
      flashbacks: [{
        id: "flashback-b",
        memoryId,
        text: "beta",
        prefix: "alpha ",
        suffix: " gamma",
        startOffset: 6,
        endOffset: 10,
        contentHash: `sha256:${"a".repeat(64)}`,
        createdAt: "2026-05-10T00:00:00.000Z",
        updatedAt: "2026-05-10T01:00:00.000Z",
      }],
    }, null, 2)}\n`);
  });

  it("rejects a temporary-file sync failure without publishing the export", async () => {
    const root = await makeRoot();
    const storePath = join(root, "store");
    const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f412";
    const exportDirectory = join(storePath, "memories", memoryId);
    await mkdir(exportDirectory, { recursive: true });
    const exportPath = join(exportDirectory, "FLASHBACKS.json");
    const input = {
      config: { storePath },
      fileSystem: instrumentedFileSystem({
        calls: [],
        fileSyncError: Object.assign(new Error("file sync failed"), {
          code: "EIO",
        }),
        root,
      }),
      flashbacks: [],
      memoryId,
    };

    await expect(writeFlashbackMetadataExport(input)).rejects.toThrow(
      "file sync failed",
    );
    await expect(access(exportPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("confirms exact target bytes before retrying post-rename directory sync", async () => {
    const root = await makeRoot();
    const storePath = join(root, "store");
    const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f413";
    const exportDirectory = join(storePath, "memories", memoryId);
    await mkdir(exportDirectory, { recursive: true });
    const calls: string[] = [];
    const input = {
      config: { storePath },
      fileSystem: instrumentedFileSystem({
        calls,
        directorySyncFailures: 1,
        directorySyncError: Object.assign(new Error("directory sync failed"), {
          code: "EIO",
        }),
        root,
      }),
      flashbacks: [],
      memoryId,
    };

    await expect(writeFlashbackMetadataExport(input)).resolves.toBe(
      `memories/${memoryId}/FLASHBACKS.json`,
    );
    expect(
      await readFile(join(exportDirectory, "FLASHBACKS.json"), "utf8"),
    ).toBe(`${JSON.stringify({ version: 1, memoryId, flashbacks: [] }, null, 2)}\n`);
    expect(calls.filter((call) => call === "rename")).toHaveLength(1);
    expect(calls.filter((call) => call === "read-target")).toHaveLength(1);
    expect(
      calls.filter((call) => call.startsWith("sync-directory:")),
    ).toHaveLength(2);
  });

  it("rejects a traversal memory id before resolving an export path", () => {
    expect(() => getSourceFlashbackMetadataExportPath("../outside"))
      .toThrow("memoryId must be a UUID v7 path segment");
  });

  it("refuses to publish through a canonical memory directory symlink outside storePath", async () => {
    const root = await makeRoot();
    const storePath = join(root, "store");
    const memoriesPath = join(storePath, "memories");
    const outsidePath = join(root, "outside-memory");
    const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f415";
    await mkdir(memoriesPath, { recursive: true });
    await mkdir(outsidePath, { recursive: true });
    await symlink(outsidePath, join(memoriesPath, memoryId), "dir");

    await expect(writeFlashbackMetadataExport({
      config: { storePath },
      flashbacks: [],
      memoryId,
    })).rejects.toThrow("escaped its owning memory directory");
    await expect(access(join(outsidePath, "FLASHBACKS.json"))).rejects
      .toMatchObject({ code: "ENOENT" });
  });
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "trauma-flashback-export-"));
  tempDirs.push(root);
  return root;
}

function instrumentedFileSystem(input: {
  calls: string[];
  directorySyncFailures?: number;
  directorySyncError?: Error;
  fileSyncError?: Error;
  root: string;
}) {
  const displayPath = (path: string) => relative(input.root, path) || ".";
  let remainingDirectorySyncFailures = input.directorySyncFailures ??
    (input.directorySyncError === undefined ? 0 : Number.POSITIVE_INFINITY);
  return {
    mkdir: async (path: string, options: { recursive: true }) => {
      input.calls.push(`mkdir:${displayPath(path)}`);
      return mkdir(path, options);
    },
    open: async (path: string, flags: "wx", mode: number) => {
      input.calls.push("open-file");
      const handle = await open(path, flags, mode);
      return {
        writeFile: async (data: string, options: BufferEncoding) => {
          input.calls.push("write-file");
          await handle.writeFile(data, options);
        },
        sync: async () => {
          input.calls.push("sync-file");
          if (input.fileSyncError !== undefined) {
            throw input.fileSyncError;
          }
          await handle.sync();
        },
        close: async () => {
          input.calls.push("close-file");
          await handle.close();
        },
      };
    },
    openDirectory: async (path: string) => {
      const displayed = displayPath(path);
      input.calls.push(`open-directory:${displayed}`);
      const handle = await open(path, "r");
      return {
        sync: async () => {
          input.calls.push(`sync-directory:${displayed}`);
          if (
            input.directorySyncError !== undefined &&
            remainingDirectorySyncFailures > 0
          ) {
            remainingDirectorySyncFailures -= 1;
            throw input.directorySyncError;
          }
          await handle.sync();
        },
        close: async () => {
          input.calls.push(`close-directory:${displayed}`);
          await handle.close();
        },
      };
    },
    readFile: async (path: string, options: BufferEncoding) => {
      input.calls.push("read-target");
      return readFile(path, options);
    },
    realpath,
    rename: async (source: string, destination: string) => {
      input.calls.push("rename");
      await rename(source, destination);
    },
    rm: (path: string, options: { force: boolean }) => rm(path, options),
  };
}
