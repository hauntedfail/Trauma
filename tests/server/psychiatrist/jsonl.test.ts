import {
  mkdtemp,
  open,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  appendJsonlRow,
  JsonlLimitError,
  readJsonlRows,
  type JsonlFileSystem,
} from "../../../src/server/psychiatrist/jsonl";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    ),
  );
});

describe("durable bounded JSONL", () => {
  it("syncs an appended row before publishing a new directory entry", async () => {
    const directory = await makeTempDirectory();
    const path = join(directory, "events.jsonl");
    const calls: string[] = [];

    await appendJsonlRow(path, { id: 1 }, {
      fileSystem: instrumentedFileSystem(calls),
    });

    expect(await readFile(path, "utf8")).toBe('{"id":1}\n');
    expect(calls).toEqual([
      "open-file",
      "write-file",
      "sync-file",
      "close-file",
      "open-directory",
      "sync-directory",
      "close-directory",
    ]);
  });

  it("repairs a torn tail and syncs the repaired append as one publication", async () => {
    const directory = await makeTempDirectory();
    const path = join(directory, "events.jsonl");
    await writeFile(path, '{"id":1}\n{"id":', "utf8");
    const calls: string[] = [];

    await appendJsonlRow(path, { id: 2 }, {
      fileSystem: instrumentedFileSystem(calls),
    });

    expect(await readFile(path, "utf8")).toBe('{"id":1}\n{"id":2}\n');
    expect(calls).toContain("truncate-file");
    expect(calls.indexOf("truncate-file")).toBeLessThan(calls.indexOf("write-file"));
    expect(calls.indexOf("write-file")).toBeLessThan(calls.indexOf("sync-file"));
  });

  it("rejects an oversized legacy file before opening it for a heap read", async () => {
    const error = await readJsonlRows("/virtual/events.jsonl", {
      fileSystem: oversizedFileSystem(),
      limits: { maxBytes: 16, maxRows: 4 },
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(JsonlLimitError);
    expect(error).toMatchObject({ kind: "bytes" });
  });

  it("rejects row and byte growth before appending", async () => {
    const directory = await makeTempDirectory();
    const path = join(directory, "events.jsonl");
    await appendJsonlRow(path, { id: 1 });

    await expect(
      appendJsonlRow(path, { id: 2 }, { limits: { maxRows: 1 } }),
    ).rejects.toMatchObject({ kind: "rows" });
    await expect(
      appendJsonlRow(path, { payload: "too-large" }, {
        limits: { maxBytes: (await stat(path)).size + 4 },
      }),
    ).rejects.toMatchObject({ kind: "bytes" });
    await expect(readJsonlRows(path)).resolves.toEqual([{ id: 1 }]);
  });
});

async function makeTempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "trauma-jsonl-"));
  tempDirectories.push(directory);
  return directory;
}

function instrumentedFileSystem(calls: string[]): JsonlFileSystem {
  return {
    open: async (path, flags) => {
      const handle = await open(path, flags);
      if (flags === "a+") {
        calls.push("open-file");
      }
      return {
        close: async () => {
          await handle.close();
          if (flags === "a+") {
            calls.push("close-file");
          }
        },
        read: (buffer, offset, length, position) =>
          handle.read(buffer, offset, length, position),
        sync: async () => {
          calls.push("sync-file");
          await handle.sync();
        },
        truncate: async (length) => {
          calls.push("truncate-file");
          await handle.truncate(length);
        },
        writeFile: async (data, options) => {
          calls.push("write-file");
          await handle.writeFile(data, options);
        },
      };
    },
    openDirectory: async (path) => {
      calls.push("open-directory");
      const handle = await open(path, "r");
      return {
        close: async () => {
          calls.push("close-directory");
          await handle.close();
        },
        sync: async () => {
          calls.push("sync-directory");
          await handle.sync();
        },
      };
    },
    stat: (path, options) => stat(path, options),
  };
}

function oversizedFileSystem(): JsonlFileSystem {
  return {
    open: async () => {
      throw new Error("bounded reader opened an oversized file");
    },
    openDirectory: async () => {
      throw new Error("directory should not be opened");
    },
    stat: async () => ({
      dev: 1n,
      ino: 1n,
      mtimeNs: 1n,
      size: 17n,
    }),
  };
}
