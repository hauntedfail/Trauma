import { randomUUID } from "node:crypto";
import {
  link,
  open,
  rename,
  rm,
  stat,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

type AtomicWriteFileHandle = Pick<FileHandle, "close" | "sync" | "writeFile">;
type AtomicWriteDirectoryHandle = Pick<FileHandle, "close" | "sync">;

export interface DirectorySyncFileSystem {
  openDirectory: (path: string) => Promise<AtomicWriteDirectoryHandle>;
}

export interface AtomicCreateFileSystem {
  link: (source: string, destination: string) => Promise<void>;
  open: (
    path: string,
    flags: "wx",
    mode: number,
  ) => Promise<AtomicWriteFileHandle>;
  openDirectory: (path: string) => Promise<AtomicWriteDirectoryHandle>;
  rm: (path: string, options: { force: boolean }) => Promise<void>;
}

export interface AtomicWriteFileSystem {
  open: (
    path: string,
    flags: "wx",
    mode: number,
  ) => Promise<AtomicWriteFileHandle>;
  openDirectory: (path: string) => Promise<AtomicWriteDirectoryHandle>;
  rename: (source: string, destination: string) => Promise<void>;
  rm: (path: string, options: { force: boolean }) => Promise<void>;
  stat: (path: string) => Promise<{ mode: number }>;
}

export interface AtomicPublishFileSystem {
  open: (
    path: string,
    flags: "wx",
    mode: number,
  ) => Promise<AtomicWriteFileHandle>;
  openDirectory: (path: string) => Promise<AtomicWriteDirectoryHandle>;
  rename: (source: string, destination: string) => Promise<void>;
  rm: (path: string, options: { force: boolean }) => Promise<void>;
}

const defaultFileSystem: AtomicWriteFileSystem = {
  open: (path, flags, mode) => open(path, flags, mode),
  openDirectory: (path) => open(path, "r"),
  rename,
  rm,
  stat,
};

const defaultCreateFileSystem: AtomicCreateFileSystem = {
  link,
  open: (path, flags, mode) => open(path, flags, mode),
  openDirectory: (path) => open(path, "r"),
  rm,
};

const defaultPublishFileSystem: AtomicPublishFileSystem = {
  open: (path, flags, mode) => open(path, flags, mode),
  openDirectory: (path) => open(path, "r"),
  rename,
  rm,
};

export async function createFileAtomically(
  targetPath: string,
  content: string,
  options: { fileSystem?: AtomicCreateFileSystem; mode?: number } = {},
): Promise<void> {
  const fileSystem = options.fileSystem ?? defaultCreateFileSystem;
  const directoryPath = dirname(targetPath);
  const temporaryPath = join(
    directoryPath,
    `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let published = false;
  let operationError: unknown;

  try {
    const temporaryFile = await fileSystem.open(
      temporaryPath,
      "wx",
      options.mode ?? 0o666,
    );
    try {
      await temporaryFile.writeFile(content, "utf8");
      await temporaryFile.sync();
    } finally {
      await temporaryFile.close();
    }

    // A hard-link publication preserves the existing no-overwrite contract;
    // Node does not expose renameat2(RENAME_NOREPLACE).
    await fileSystem.link(temporaryPath, targetPath);
    published = true;
    await syncDirectoryBestEffort(directoryPath, fileSystem);
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await fileSystem.rm(temporaryPath, { force: true });
    } catch (cleanupError) {
      if (operationError === undefined && !published) {
        throw cleanupError;
      }
    }
  }
}

export async function writeFileAtomically(
  targetPath: string,
  content: string,
  options: { fileSystem?: AtomicWriteFileSystem } = {},
): Promise<void> {
  const fileSystem = options.fileSystem ?? defaultFileSystem;
  const directoryPath = dirname(targetPath);
  const targetStats = await fileSystem.stat(targetPath);
  const temporaryPath = join(
    directoryPath,
    `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let replaced = false;
  let operationError: unknown;

  try {
    const temporaryFile = await fileSystem.open(
      temporaryPath,
      "wx",
      targetStats.mode & 0o777,
    );
    try {
      await temporaryFile.writeFile(content, "utf8");
      await temporaryFile.sync();
    } finally {
      await temporaryFile.close();
    }

    await fileSystem.rename(temporaryPath, targetPath);
    replaced = true;
    await syncDirectoryBestEffort(directoryPath, fileSystem);
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    if (!replaced) {
      try {
        await fileSystem.rm(temporaryPath, { force: true });
      } catch (cleanupError) {
        if (operationError === undefined) {
          throw cleanupError;
        }
      }
    }
  }
}

export async function publishFileAtomically(
  targetPath: string,
  content: string,
  options: { fileSystem?: AtomicPublishFileSystem; mode?: number } = {},
): Promise<void> {
  const fileSystem = options.fileSystem ?? defaultPublishFileSystem;
  const directoryPath = dirname(targetPath);
  const temporaryPath = join(
    directoryPath,
    `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let published = false;
  let operationError: unknown;

  try {
    const temporaryFile = await fileSystem.open(
      temporaryPath,
      "wx",
      options.mode ?? 0o666,
    );
    try {
      await temporaryFile.writeFile(content, "utf8");
      await temporaryFile.sync();
    } finally {
      await temporaryFile.close();
    }

    await fileSystem.rename(temporaryPath, targetPath);
    published = true;
    await syncDirectoryBestEffort(directoryPath, fileSystem);
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    if (!published) {
      try {
        await fileSystem.rm(temporaryPath, { force: true });
      } catch (cleanupError) {
        if (operationError === undefined) {
          throw cleanupError;
        }
      }
    }
  }
}

export async function syncDirectoryBestEffort(
  directoryPath: string,
  fileSystem: DirectorySyncFileSystem = defaultFileSystem,
): Promise<void> {
  try {
    const directory = await fileSystem.openDirectory(directoryPath);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    if (
      !isNodeError(error) ||
      !["EBADF", "EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(
        error.code ?? "",
      )
    ) {
      throw error;
    }
    // Some filesystems do not support directory fsync. The temporary file
    // fsync and same-directory atomic rename remain required.
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
