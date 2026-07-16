import { randomUUID } from "node:crypto";
import {
  open,
  rename,
  rm,
  stat,
  type FileHandle,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";

type AtomicWriteFileHandle = Pick<FileHandle, "close" | "sync" | "writeFile">;
type AtomicWriteDirectoryHandle = Pick<FileHandle, "close" | "sync">;

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

const defaultFileSystem: AtomicWriteFileSystem = {
  open: (path, flags, mode) => open(path, flags, mode),
  openDirectory: (path) => open(path, "r"),
  rename,
  rm,
  stat,
};

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

async function syncDirectoryBestEffort(
  directoryPath: string,
  fileSystem: AtomicWriteFileSystem,
): Promise<void> {
  try {
    const directory = await fileSystem.openDirectory(directoryPath);
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch {
    // Some filesystems do not support directory fsync. The temporary file
    // fsync and same-directory atomic rename remain required.
  }
}
