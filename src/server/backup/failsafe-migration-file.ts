import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { syncDirectoryBestEffort } from "../files/atomic-write";

type SyncFileHandle = Pick<FileHandle, "close" | "sync">;
type FileStatus = {
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
};

export interface BackupFailsafeMigrationFileSystem {
  copyFile: (
    source: string,
    destination: string,
    mode?: number,
  ) => Promise<void>;
  link: (source: string, destination: string) => Promise<void>;
  lstat: (path: string) => Promise<FileStatus>;
  mkdir: (
    path: string,
    options?: { recursive?: boolean },
  ) => Promise<string | undefined | void>;
  openDirectory: (path: string) => Promise<SyncFileHandle>;
  openForSync: (path: string) => Promise<SyncFileHandle>;
  readFile: (path: string) => Promise<Buffer>;
  realpath: (path: string) => Promise<string>;
  remove: (path: string, options: { force: boolean }) => Promise<void>;
}

const defaultFileSystem: BackupFailsafeMigrationFileSystem = {
  copyFile,
  link,
  lstat,
  mkdir,
  openDirectory: (path) => open(path, "r"),
  // copyFile preserves a read-only source mode. fsync does not require the
  // snapshot to be opened for writing.
  openForSync: (path) => open(path, "r"),
  readFile,
  realpath,
  remove: (path, options) => rm(path, options),
};

const TEMPORARY_MARKER = ".trauma-failsafe-migrate.";
const OWNER_TOKEN_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/u;

export async function copyBackupFailsafeMigrationFile(
  sourcePath: string,
  targetPath: string,
  options: {
    fileSystem?: BackupFailsafeMigrationFileSystem;
    ownerToken?: string;
    targetRoot?: string;
  } = {},
): Promise<void> {
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  const targetRoot = resolve(options.targetRoot ?? dirname(targetPath));
  const absoluteTarget = resolve(targetPath);
  const targetDirectory = dirname(absoluteTarget);
  const ownerToken = options.ownerToken ?? randomUUID();
  if (!OWNER_TOKEN_PATTERN.test(ownerToken)) {
    throw new Error("invalid backup migration temporary-file owner token");
  }
  if (!isStrictlyInside(targetRoot, absoluteTarget)) {
    throw new Error("backup migration destination must stay under targetRoot");
  }

  const sourceStatus = await fileSystem.lstat(sourcePath);
  if (sourceStatus.isSymbolicLink() || !sourceStatus.isFile()) {
    throw new Error("unsafe backup migration source");
  }

  await ensureSafeDestinationDirectories({
    targetRoot,
    targetDirectory,
    fileSystem,
    createMissing: true,
  });

  const temporaryPath = join(
    targetDirectory,
    `.${basename(absoluteTarget)}${TEMPORARY_MARKER}${ownerToken}.tmp`,
  );
  // This path is deterministic for one approved alert generation. Never scan
  // or delete another operation's similarly named files.
  await fileSystem.remove(temporaryPath, { force: true });

  let operationError: unknown;
  try {
    await fileSystem.copyFile(
      sourcePath,
      temporaryPath,
      constants.COPYFILE_EXCL,
    );
    const temporaryFile = await fileSystem.openForSync(temporaryPath);
    try {
      await temporaryFile.sync();
    } finally {
      await temporaryFile.close();
    }

    // Re-check every destination component and canonical containment at the
    // publication boundary. Hard-link publication is atomic and preserves the
    // no-overwrite contract; Node does not expose renameat2(RENAME_NOREPLACE).
    await ensureSafeDestinationDirectories({
      targetRoot,
      targetDirectory,
      fileSystem,
      createMissing: false,
    });
    await assertSafeFinalTarget(absoluteTarget, fileSystem);
    try {
      await fileSystem.link(temporaryPath, absoluteTarget);
    } catch (error) {
      if (
        !isErrorWithCode(error, "EEXIST") ||
        !(await filesHaveSameContent(
          temporaryPath,
          absoluteTarget,
          fileSystem,
        ))
      ) {
        if (isErrorWithCode(error, "EEXIST")) {
          throw new BackupFailsafeMigrationConflictError(absoluteTarget);
        }
        throw error;
      }
    }

    await syncDirectoryBestEffort(targetDirectory, fileSystem);
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await fileSystem.remove(temporaryPath, { force: true });
    } catch (cleanupError) {
      if (operationError === undefined) {
        throw cleanupError;
      }
    }
  }
}

async function ensureSafeDestinationDirectories(input: {
  targetRoot: string;
  targetDirectory: string;
  fileSystem: BackupFailsafeMigrationFileSystem;
  createMissing: boolean;
}) {
  if (!isInsideOrEqual(input.targetRoot, input.targetDirectory)) {
    throw new Error("backup migration destination must stay under targetRoot");
  }

  let rootStatus = await lstatIfPresent(input.targetRoot, input.fileSystem);
  if (rootStatus === null) {
    if (!input.createMissing) {
      throw new Error(`unsafe destination path component: ${input.targetRoot}`);
    }
    await input.fileSystem.mkdir(input.targetRoot, { recursive: true });
    rootStatus = await lstatIfPresent(input.targetRoot, input.fileSystem);
  }
  if (
    rootStatus === null ||
    rootStatus.isSymbolicLink() ||
    !rootStatus.isDirectory()
  ) {
    throw new Error(`unsafe destination path component: ${input.targetRoot}`);
  }

  const components = relative(input.targetRoot, input.targetDirectory)
    .split(/[\\/]+/u)
    .filter(Boolean);
  let current = input.targetRoot;
  for (const component of components) {
    current = join(current, component);
    let status = await lstatIfPresent(current, input.fileSystem);
    if (status === null) {
      if (
        !input.createMissing ||
        !isInsideOrEqual(input.targetRoot, current)
      ) {
        throw new Error(`unsafe destination path component: ${current}`);
      }
      await input.fileSystem.mkdir(current);
      status = await lstatIfPresent(current, input.fileSystem);
    }
    if (
      status === null ||
      status.isSymbolicLink() ||
      !status.isDirectory()
    ) {
      throw new Error(`unsafe destination path component: ${current}`);
    }
  }

  const [canonicalRoot, canonicalDirectory] = await Promise.all([
    input.fileSystem.realpath(input.targetRoot),
    input.fileSystem.realpath(input.targetDirectory),
  ]);
  if (!isInsideOrEqual(canonicalRoot, canonicalDirectory)) {
    throw new Error("backup migration destination escaped targetRoot");
  }
}

async function assertSafeFinalTarget(
  targetPath: string,
  fileSystem: BackupFailsafeMigrationFileSystem,
) {
  const status = await lstatIfPresent(targetPath, fileSystem);
  if (
    status !== null &&
    (status.isSymbolicLink() || !status.isFile())
  ) {
    throw new BackupFailsafeMigrationConflictError(targetPath);
  }
}

async function lstatIfPresent(
  path: string,
  fileSystem: BackupFailsafeMigrationFileSystem,
) {
  try {
    return await fileSystem.lstat(path);
  } catch (error) {
    if (isErrorWithCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

async function filesHaveSameContent(
  left: string,
  right: string,
  fileSystem: BackupFailsafeMigrationFileSystem,
) {
  try {
    const rightStatus = await fileSystem.lstat(right);
    if (rightStatus.isSymbolicLink() || !rightStatus.isFile()) {
      return false;
    }
    const [leftContent, rightContent] = await Promise.all([
      fileSystem.readFile(left),
      fileSystem.readFile(right),
    ]);
    return leftContent.equals(rightContent);
  } catch {
    return false;
  }
}

function isInsideOrEqual(parent: string, child: string) {
  const path = relative(resolve(parent), resolve(child));
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function isStrictlyInside(parent: string, child: string) {
  const path = relative(resolve(parent), resolve(child));
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

function isErrorWithCode(error: unknown, code: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

export class BackupFailsafeMigrationConflictError extends Error {
  constructor(targetPath: string) {
    super(`refusing to overwrite existing backup content: ${targetPath}`);
    this.name = "BackupFailsafeMigrationConflictError";
  }
}
