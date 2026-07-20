import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initializeDatabase, schema } from "../../../src/server/db";
import {
  writeFlashbackMetadataExport,
} from "../../../src/server/flashbacks/export";
import { toggleMemoryFlashback } from "../../../src/server/flashbacks/toggle";
import { sourceFlashbackVariant } from "../../../src/server/flashbacks/variant";
import { reconcileFlashbackMetadataExport } from "../../../src/server/flashbacks/reconciliation";
import { recoverFlashbackExportReconciliationIntents } from "../../../src/server/flashbacks/export-intent";
import { writeMemoryContent } from "../../../src/server/store";

const tempDirs: string[] = [];
const connections: Array<ReturnType<typeof initializeDatabase>> = [];

afterEach(async () => {
  for (const connection of connections.splice(0)) {
    connection.close();
  }
  await Promise.all(
    tempDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

describe("Flashback durable export failure", () => {
  it("durably records reconciliation intent before mutating SQLite", async () => {
    const fixture = await createFixture();
    fixture.connection.sqlite.exec(`
      create trigger reject_flashback_insert
      before insert on flashbacks
      begin
        select raise(abort, 'simulated SQLite mutation failure');
      end;
    `);

    await expect(toggleMemoryFlashback(createToggleInput(
      fixture,
      instrumentedFileSystem({ directorySyncFailures: 0 }),
    ))).rejects.toThrow("simulated SQLite mutation failure");

    expect(readFlashbackRows(fixture)).toEqual([{
      id: "flashback-existing",
      startOffset: 6,
      endOffset: 12,
    }]);
    await expect(readdir(join(
      fixture.config.storePath,
      ".operations",
      "flashback-exports",
    ))).resolves.toHaveLength(1);

    fixture.connection.sqlite.exec("drop trigger reject_flashback_insert");
    await expect(recoverFlashbackExportReconciliationIntents({
      config: fixture.config,
      repositories: fixture.connection.repositories,
    })).resolves.toBe(1);
    await expect(readExportedFlashbackIds(fixture)).resolves.toEqual([
      "flashback-existing",
    ]);
    await expect(readdir(join(
      fixture.config.storePath,
      ".operations",
      "flashback-exports",
    ))).resolves.toEqual([]);
  });

  it("rolls SQLite back when temporary-file sync fails before rename", async () => {
    const fixture = await createFixture();
    const fileSystem = instrumentedFileSystem({
      directorySyncFailures: 0,
      fileSyncError: Object.assign(new Error("file sync failed"), {
        code: "EIO",
      }),
    });

    await expect(
      toggleMemoryFlashback(createToggleInput(fixture, fileSystem)),
    ).rejects.toThrow("file sync failed");

    expect(readFlashbackRows(fixture)).toEqual([{
      id: "flashback-existing",
      startOffset: 6,
      endOffset: 12,
    }]);
    expect(await readFile(fixture.exportPath, "utf8")).toBe(
      fixture.previousExport,
    );
    expect(fileSystem.renameCount()).toBe(0);
  });

  it("confirms a post-rename publication by exact bytes and directory-sync retry", async () => {
    const fixture = await createFixture();
    const fileSystem = instrumentedFileSystem({ directorySyncFailures: 1 });

    await expect(
      toggleMemoryFlashback(createToggleInput(fixture, fileSystem)),
    ).resolves.toMatchObject({
      operation: "flashbacked",
      flashbacks: [
        { id: "flashback-existing" },
        { id: "flashback-new" },
      ],
    });

    expect(readFlashbackRows(fixture)).toEqual([
      { id: "flashback-existing", startOffset: 6, endOffset: 12 },
      { id: "flashback-new", startOffset: 25, endOffset: 31 },
    ]);
    await expect(readExportedFlashbackIds(fixture)).resolves.toEqual([
      "flashback-existing",
      "flashback-new",
    ]);
    expect(fileSystem.renameCount()).toBe(1);
    expect(fileSystem.directorySyncCount()).toBe(2);
    expect(fileSystem.targetReadCount()).toBe(1);
  });

  it("keeps matching SQLite and visible export state when durability remains unconfirmed", async () => {
    const fixture = await createFixture();
    const fileSystem = instrumentedFileSystem({
      directorySyncFailures: Number.POSITIVE_INFINITY,
    });

    const result = await toggleMemoryFlashback(
      createToggleInput(fixture, fileSystem),
    );
    expect(result).toMatchObject({
      operation: "flashbacked",
      durability: {
        status: "unconfirmed",
        warning: {
          code: "flashback_export_durability_unconfirmed",
          message:
            "Flashback change was saved, but export durability could not be confirmed.",
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("targetMatchesExpected");
    expect(JSON.stringify(result)).not.toContain(fixture.exportPath);

    expect(readFlashbackRows(fixture)).toEqual([
      { id: "flashback-existing", startOffset: 6, endOffset: 12 },
      { id: "flashback-new", startOffset: 25, endOffset: 31 },
    ]);
    await expect(readExportedFlashbackIds(fixture)).resolves.toEqual([
      "flashback-existing",
      "flashback-new",
    ]);
    expect(fileSystem.renameCount()).toBe(1);
    expect(fileSystem.directorySyncCount()).toBe(2);
    expect(fileSystem.targetReadCount()).toBe(1);
  });

  it("does not roll SQLite behind the renamed export when confirmation cannot read", async () => {
    const fixture = await createFixture();
    const fileSystem = instrumentedFileSystem({
      directorySyncFailures: 1,
      targetReadError: Object.assign(new Error("target read failed"), {
        code: "EIO",
      }),
    });

    const result = await toggleMemoryFlashback(
      createToggleInput(fixture, fileSystem),
    );
    expect(result).toMatchObject({
      durability: {
        status: "unconfirmed",
        warning: {
          code: "flashback_export_durability_unconfirmed",
        },
      },
    });
    expect(readFlashbackRows(fixture)).toEqual([
      { id: "flashback-existing", startOffset: 6, endOffset: 12 },
      { id: "flashback-new", startOffset: 25, endOffset: 31 },
    ]);
    await expect(readExportedFlashbackIds(fixture)).resolves.toEqual([
      "flashback-existing",
      "flashback-new",
    ]);
    expect(fileSystem.renameCount()).toBe(1);
    expect(fileSystem.directorySyncCount()).toBe(1);
    expect(fileSystem.targetReadCount()).toBe(1);

    const recoveryFileSystem = instrumentedFileSystem({
      directorySyncFailures: 0,
    });
    await reconcileCurrentExport(fixture, recoveryFileSystem);
    await expect(readExportedFlashbackIds(fixture)).resolves.toEqual([
      "flashback-existing",
      "flashback-new",
    ]);
    expect(recoveryFileSystem.renameCount()).toBe(1);
    expect(recoveryFileSystem.directorySyncCount()).toBe(1);
  });

  it("reconciles an uncertain unflashback from authoritative empty SQLite rows", async () => {
    const fixture = await createFixture();
    const fileSystem = instrumentedFileSystem({
      directorySyncFailures: Number.POSITIVE_INFINITY,
      targetReadError: Object.assign(new Error("target read failed"), {
        code: "EIO",
      }),
    });

    const result = await toggleMemoryFlashback(
      createUnflashbackInput(fixture, fileSystem),
    );
    expect(result).toMatchObject({
      operation: "unflashbacked",
      durability: {
        status: "unconfirmed",
        warning: {
          code: "flashback_export_durability_unconfirmed",
        },
      },
      flashbacks: [],
    });
    expect(readFlashbackRows(fixture)).toEqual([]);
    await expect(readExportedFlashbackIds(fixture)).resolves.toEqual([]);

    const recoveryFileSystem = instrumentedFileSystem({
      directorySyncFailures: 0,
    });
    await reconcileCurrentExport(fixture, recoveryFileSystem);
    expect(readFlashbackRows(fixture)).toEqual([]);
    await expect(readExportedFlashbackIds(fixture)).resolves.toEqual([]);
    expect(recoveryFileSystem.renameCount()).toBe(1);
    expect(recoveryFileSystem.directorySyncCount()).toBe(1);
  });

  it("serializes recovery row reads and publication with a newer toggle", async () => {
    const fixture = await createFixture();
    const recoveryRead = deferred<void>();
    const releaseRecovery = deferred<void>();
    const recovery = reconcileFlashbackMetadataExport({
      beforeWrite: async () => {
        recoveryRead.resolve();
        await releaseRecovery.promise;
      },
      config: fixture.config,
      flashbacks: fixture.connection.repositories.flashbacks,
      memoryId: fixture.memoryId,
      variant: sourceFlashbackVariant,
    });
    await recoveryRead.promise;

    const toggle = toggleMemoryFlashback(createToggleInput(
      fixture,
      instrumentedFileSystem({ directorySyncFailures: 0 }),
    ));
    await Promise.resolve();
    expect(readFlashbackRows(fixture)).toEqual([{
      id: "flashback-existing",
      startOffset: 6,
      endOffset: 12,
    }]);

    releaseRecovery.resolve();
    await Promise.all([recovery, toggle]);

    expect(readFlashbackRows(fixture)).toEqual([
      { id: "flashback-existing", startOffset: 6, endOffset: 12 },
      { id: "flashback-new", startOffset: 25, endOffset: 31 },
    ]);
    await expect(readExportedFlashbackIds(fixture)).resolves.toEqual([
      "flashback-existing",
      "flashback-new",
    ]);
  });
});

interface Fixture {
  config: {
    configFilePath: string;
    projectPath: string;
    storePath: string;
    databasePath: string;
    backup: {
      git: {
        enabled: false;
        remote: string;
        branch: string;
        push: false;
        commitMessageTemplate: string;
      };
    };
  };
  connection: ReturnType<typeof initializeDatabase>;
  exportPath: string;
  markdown: string;
  memoryId: string;
  previousExport: string;
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "trauma-flashback-toggle-sync-"));
  tempDirs.push(root);
  const memoryId = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f414";
  const markdown = "Alpha target beta second target.";
  const now = new Date("2026-05-10T00:00:00.000Z");
  const config = {
    configFilePath: join(root, "trauma.config.json"),
    projectPath: join(root, "data"),
    storePath: join(root, "data/store"),
    databasePath: join(root, ".trauma/trauma.sqlite"),
    backup: {
      git: {
        enabled: false as const,
        remote: "origin",
        branch: "main",
        push: false as const,
        commitMessageTemplate: "backup memory {memoryId}",
      },
    },
  };
  const connection = initializeDatabase(config);
  connections.push(connection);

  await connection.db.insert(schema.memories).values({
    id: memoryId,
    url: "https://example.com/flashback-export-sync",
    title: "Flashback Export Sync",
    description: null,
    faviconUrl: null,
    contentPath: `memories/${memoryId}/CONTENT.md`,
    extractionStatus: "success",
    extractionError: null,
    backupStatus: "disabled",
    lastBackupAt: null,
    lastBackupError: null,
    createdAt: now,
    updatedAt: now,
  });
  await writeMemoryContent({
    config,
    memoryId,
    frontmatter: {
      id: memoryId,
      url: "https://example.com/flashback-export-sync",
      title: "Flashback Export Sync",
      capturedAt: now.toISOString(),
      extractionStatus: "success",
    },
    markdown,
  });
  const existing = {
    id: "flashback-existing",
    memoryId,
    text: "target",
    prefix: "Alpha ",
    suffix: " beta second target.",
    startOffset: 6,
    endOffset: 12,
    contentHash: null,
    createdAt: now,
    updatedAt: now,
  };
  await connection.db.insert(schema.flashbacks).values(existing);
  await writeFlashbackMetadataExport({
    config,
    flashbacks: [existing],
    memoryId,
  });
  const exportPath = join(
    config.storePath,
    "memories",
    memoryId,
    "FLASHBACKS.json",
  );

  return {
    config,
    connection,
    exportPath,
    markdown,
    memoryId,
    previousExport: await readFile(exportPath, "utf8"),
  };
}

function createToggleInput(
  fixture: Fixture,
  flashbackExportFileSystem: ReturnType<typeof instrumentedFileSystem>,
) {
  const startOffset = fixture.markdown.lastIndexOf("target");
  return {
    memoryId: fixture.memoryId,
    operation: "flashback" as const,
    selection: {
      text: "target",
      prefix: "second ",
      suffix: ".",
      startOffset,
      endOffset: startOffset + "target".length,
    },
    config: fixture.config,
    db: fixture.connection.db,
    backupQueue: {
      persistIntent: async () => ({ backupStatus: "disabled" as const }),
      enqueue: async () => ({ backupStatus: "disabled" as const }),
    },
    flashbackExportFileSystem,
    generateId: () => "flashback-new",
    now: () => new Date("2026-05-10T01:00:00.000Z"),
  };
}

function createUnflashbackInput(
  fixture: Fixture,
  flashbackExportFileSystem: ReturnType<typeof instrumentedFileSystem>,
) {
  return {
    memoryId: fixture.memoryId,
    operation: "unflashback" as const,
    selection: {
      text: "target",
      prefix: "Alpha ",
      suffix: " beta second target.",
      startOffset: 6,
      endOffset: 12,
    },
    config: fixture.config,
    db: fixture.connection.db,
    backupQueue: {
      persistIntent: async () => ({ backupStatus: "disabled" as const }),
      enqueue: async () => ({ backupStatus: "disabled" as const }),
    },
    flashbackExportFileSystem,
    generateId: () => "unused",
    now: () => new Date("2026-05-10T01:00:00.000Z"),
  };
}

async function reconcileCurrentExport(
  fixture: Fixture,
  fileSystem: ReturnType<typeof instrumentedFileSystem>,
): Promise<void> {
  const rows = await fixture.connection.repositories.flashbacks
    .listForMemoryVariant({
      memoryId: fixture.memoryId,
      variant: sourceFlashbackVariant,
    });
  await writeFlashbackMetadataExport({
    config: fixture.config,
    fileSystem,
    flashbacks: rows,
    memoryId: fixture.memoryId,
  });
}

function readFlashbackRows(fixture: Fixture) {
  return fixture.connection.sqlite
    .prepare(
      "select id, start_offset as startOffset, end_offset as endOffset from flashbacks order by id",
    )
    .all();
}

async function readExportedFlashbackIds(fixture: Fixture): Promise<string[]> {
  const payload = JSON.parse(await readFile(fixture.exportPath, "utf8")) as {
    flashbacks: Array<{ id: string }>;
  };
  return payload.flashbacks.map((flashback) => flashback.id);
}

function instrumentedFileSystem(input: {
  directorySyncFailures: number;
  fileSyncError?: Error;
  targetReadError?: Error;
}) {
  let directorySyncCount = 0;
  let remainingDirectorySyncFailures = input.directorySyncFailures;
  let renameCount = 0;
  let targetReadCount = 0;
  return {
    directorySyncCount: () => directorySyncCount,
    mkdir: (path: string, options: { recursive: true }) => mkdir(path, options),
    open: async (path: string, flags: "wx", mode: number) => {
      const handle = await open(path, flags, mode);
      return {
        writeFile: (data: string, options: BufferEncoding) =>
          handle.writeFile(data, options),
        sync: async () => {
          if (input.fileSyncError !== undefined) {
            throw input.fileSyncError;
          }
          await handle.sync();
        },
        close: () => handle.close(),
      };
    },
    openDirectory: async (path: string) => {
      const handle = await open(path, "r");
      return {
        sync: async () => {
          directorySyncCount += 1;
          if (remainingDirectorySyncFailures > 0) {
            remainingDirectorySyncFailures -= 1;
            throw Object.assign(new Error("directory sync failed"), {
              code: "EIO",
            });
          }
          await handle.sync();
        },
        close: () => handle.close(),
      };
    },
    readFile: async (path: string, options: BufferEncoding) => {
      targetReadCount += 1;
      if (input.targetReadError !== undefined) {
        throw input.targetReadError;
      }
      return readFile(path, options);
    },
    realpath,
    rename: async (source: string, destination: string) => {
      renameCount += 1;
      await rename(source, destination);
    },
    renameCount: () => renameCount,
    rm: (path: string, options: { force: boolean }) => rm(path, options),
    targetReadCount: () => targetReadCount,
  };
}

function deferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromiseValue) => {
    resolvePromise = resolvePromiseValue;
  });
  return { promise, resolve: resolvePromise };
}
