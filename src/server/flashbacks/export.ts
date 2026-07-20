import { mkdir, open, readFile, realpath, rename, rm } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";

import type { ResolvedTraumaConfig } from "../config";
import {
  AtomicFilePublicationUncertainError,
  publishFileAtomically,
  syncDirectoryBestEffort,
  type AtomicPublishFileSystem,
} from "../files/atomic-write";
import {
  sourceFlashbackVariant,
  type FlashbackVariant,
} from "./variant";
import { withMemoryArtifactMutation } from "../memories/mutation-reservation";
import { resolveMemoryContentPath } from "../store/memory-content";
import { resolveTranslatedMemoryContentPath } from "../translation/paths";

export const FLASHBACK_METADATA_EXPORT_FILENAME = "FLASHBACKS.json";

export interface FlashbackMetadataExportRow {
  id: string;
  memoryId: string;
  text: string;
  prefix: string;
  suffix: string;
  startOffset: number;
  endOffset: number;
  contentHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface FlashbackMetadataExportFileSystem
  extends AtomicPublishFileSystem {
  mkdir: (
    path: string,
    options: { recursive: true },
  ) => Promise<string | undefined>;
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  realpath: (path: string) => Promise<string>;
}

export class FlashbackMetadataExportDurabilityError extends Error {
  override readonly cause: unknown;
  readonly code = "flashback_export_durability_unconfirmed";

  constructor(
    public readonly relativePath: string,
    public readonly targetMatchesExpected: boolean,
    cause: unknown,
  ) {
    super("FLASHBACKS.json publication durability could not be confirmed.");
    this.name = "FlashbackMetadataExportDurabilityError";
    this.cause = cause;
  }
}

const defaultFileSystem: FlashbackMetadataExportFileSystem = {
  mkdir: (path, options) => mkdir(path, options),
  open: (path, flags, mode) => open(path, flags, mode),
  openDirectory: (path) => open(path, "r"),
  readFile: (path, encoding) => readFile(path, encoding),
  realpath,
  rename,
  rm,
};

export function getFlashbackMetadataExportPath(
  input:
    | string
    | {
        memoryId: string;
        variant: FlashbackVariant;
      },
): string {
  const memoryId = typeof input === "string" ? input : input.memoryId;
  const variant = typeof input === "string"
    ? sourceFlashbackVariant
    : input.variant;
  return resolveFlashbackMetadataExportPath({
    config: { storePath: "." },
    memoryId,
    variant,
  }).relativePath;
}

export function getSourceFlashbackMetadataExportPath(memoryId: string): string {
  return getFlashbackMetadataExportPath({
    memoryId,
    variant: sourceFlashbackVariant,
  });
}

export function getTranslatedFlashbackMetadataExportPath(input: {
  langCode: string;
  memoryId: string;
}): string {
  const contentPath = resolveTranslatedMemoryContentPath({
    config: { storePath: "." },
    langCode: input.langCode,
    memoryId: input.memoryId,
  });
  return posix.join(
    posix.dirname(contentPath.relativePath),
    FLASHBACK_METADATA_EXPORT_FILENAME,
  );
}

export async function writeFlashbackMetadataExport(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  fileSystem?: FlashbackMetadataExportFileSystem;
  memoryId: string;
  variant?: FlashbackVariant;
  flashbacks: readonly FlashbackMetadataExportRow[];
}): Promise<string> {
  return withMemoryArtifactMutation(
    { memoryId: input.memoryId, storePath: input.config.storePath },
    async (reservation) => {
      reservation.assertWritable();
      return writeFlashbackMetadataExportReserved(input);
    },
  );
}

async function writeFlashbackMetadataExportReserved(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  fileSystem?: FlashbackMetadataExportFileSystem;
  memoryId: string;
  variant?: FlashbackVariant;
  flashbacks: readonly FlashbackMetadataExportRow[];
}): Promise<string> {
  const variant = input.variant ?? sourceFlashbackVariant;
  const resolvedPath = resolveFlashbackMetadataExportPath({
    config: input.config,
    memoryId: input.memoryId,
    variant,
  });
  const {
    absolutePath,
    directoryPath,
    memoryDirectoryPath,
    relativePath,
  } = resolvedPath;
  const fileSystem = input.fileSystem ?? defaultFileSystem;
  await assertExistingFlashbackExportOwnership({
    directoryPath,
    fileSystem,
    memoryDirectoryPath,
    storePath: input.config.storePath,
  });
  await createDirectoryHierarchyDurably(
    directoryPath,
    fileSystem,
  );
  await assertFlashbackExportOwnership({
    directoryPath,
    fileSystem,
    memoryDirectoryPath,
    storePath: input.config.storePath,
  });
  const content = `${JSON.stringify(
    toExportPayload({ ...input, variant }),
    null,
    2,
  )}\n`;
  await assertFlashbackExportOwnership({
    directoryPath,
    fileSystem,
    memoryDirectoryPath,
    storePath: input.config.storePath,
  });
  try {
    await publishFileAtomically(absolutePath, content, { fileSystem });
  } catch (error) {
    if (!(error instanceof AtomicFilePublicationUncertainError)) {
      throw error;
    }
    const targetMatchesExpected = await targetHasExactContent(
      absolutePath,
      content,
      fileSystem,
    );
    if (targetMatchesExpected) {
      try {
        await syncDirectoryBestEffort(directoryPath, fileSystem);
        return relativePath;
      } catch (confirmationError) {
        throw new FlashbackMetadataExportDurabilityError(
          relativePath,
          true,
          confirmationError,
        );
      }
    }
    throw new FlashbackMetadataExportDurabilityError(
      relativePath,
      false,
      error,
    );
  }
  return relativePath;
}

function resolveFlashbackMetadataExportPath(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  memoryId: string;
  variant: FlashbackVariant;
}) {
  const sourceContentPath = resolveMemoryContentPath(
    input.config,
    input.memoryId,
  );
  const memoryDirectoryPath = dirname(sourceContentPath.absolutePath);
  if (input.variant.kind === "source") {
    return {
      absolutePath: join(memoryDirectoryPath, FLASHBACK_METADATA_EXPORT_FILENAME),
      directoryPath: memoryDirectoryPath,
      memoryDirectoryPath,
      relativePath: posix.join(
        posix.dirname(sourceContentPath.relativePath),
        FLASHBACK_METADATA_EXPORT_FILENAME,
      ),
    };
  }

  const translatedContentPath = resolveTranslatedMemoryContentPath({
    config: input.config,
    langCode: input.variant.langCode,
    memoryId: input.memoryId,
  });
  const directoryPath = dirname(translatedContentPath.absolutePath);
  return {
    absolutePath: join(directoryPath, FLASHBACK_METADATA_EXPORT_FILENAME),
    directoryPath,
    memoryDirectoryPath,
    relativePath: posix.join(
      posix.dirname(translatedContentPath.relativePath),
      FLASHBACK_METADATA_EXPORT_FILENAME,
    ),
  };
}

async function assertExistingFlashbackExportOwnership(input: {
  directoryPath: string;
  fileSystem: FlashbackMetadataExportFileSystem;
  memoryDirectoryPath: string;
  storePath: string;
}): Promise<void> {
  const effectiveStorePath = await realpathIfPresent(
    input.storePath,
    input.fileSystem,
  );
  const effectiveMemoryPath = await realpathIfPresent(
    input.memoryDirectoryPath,
    input.fileSystem,
  );
  if (effectiveStorePath === undefined || effectiveMemoryPath === undefined) {
    return;
  }
  assertContainedPath(effectiveStorePath, effectiveMemoryPath, false);

  const effectiveDirectoryPath = await realpathIfPresent(
    input.directoryPath,
    input.fileSystem,
  );
  if (effectiveDirectoryPath !== undefined) {
    assertContainedPath(effectiveMemoryPath, effectiveDirectoryPath, true);
  }
}

async function assertFlashbackExportOwnership(input: {
  directoryPath: string;
  fileSystem: FlashbackMetadataExportFileSystem;
  memoryDirectoryPath: string;
  storePath: string;
}): Promise<void> {
  const [effectiveStorePath, effectiveMemoryPath, effectiveDirectoryPath] =
    await Promise.all([
      input.fileSystem.realpath(input.storePath),
      input.fileSystem.realpath(input.memoryDirectoryPath),
      input.fileSystem.realpath(input.directoryPath),
    ]);
  assertContainedPath(effectiveStorePath, effectiveMemoryPath, false);
  assertContainedPath(effectiveMemoryPath, effectiveDirectoryPath, true);
}

async function realpathIfPresent(
  path: string,
  fileSystem: FlashbackMetadataExportFileSystem,
): Promise<string | undefined> {
  try {
    return await fileSystem.realpath(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function assertContainedPath(
  ownerPath: string,
  candidatePath: string,
  allowOwner: boolean,
): void {
  const relativePath = relative(ownerPath, candidatePath);
  if (
    (!allowOwner && relativePath === "") ||
    isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  ) {
    throw new Error("Flashback export path escaped its owning memory directory.");
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function targetHasExactContent(
  absolutePath: string,
  expected: string,
  fileSystem: FlashbackMetadataExportFileSystem,
): Promise<boolean> {
  try {
    return await fileSystem.readFile(absolutePath, "utf8") === expected;
  } catch {
    return false;
  }
}

async function createDirectoryHierarchyDurably(
  directoryPath: string,
  fileSystem: FlashbackMetadataExportFileSystem,
): Promise<void> {
  const firstCreatedDirectory = await fileSystem.mkdir(directoryPath, {
    recursive: true,
  });
  if (firstCreatedDirectory === undefined) {
    return;
  }

  const firstCreated = resolve(firstCreatedDirectory);
  const target = resolve(directoryPath);
  const descendants = relative(firstCreated, target);
  if (
    isAbsolute(descendants) ||
    descendants === ".." ||
    descendants.startsWith(`..${sep}`)
  ) {
    throw new Error(
      "Created Flashback export directory escaped its target hierarchy.",
    );
  }

  await syncDirectoryBestEffort(dirname(firstCreated), fileSystem);
  let parent = firstCreated;
  for (const segment of descendants.split(sep).filter(Boolean)) {
    await syncDirectoryBestEffort(parent, fileSystem);
    parent = join(parent, segment);
  }
}

function toExportPayload(input: {
  memoryId: string;
  variant: FlashbackVariant;
  flashbacks: readonly FlashbackMetadataExportRow[];
}) {
  const flashbacks = [...input.flashbacks]
    .toSorted((left, right) => {
      if (left.startOffset !== right.startOffset) {
        return left.startOffset - right.startOffset;
      }
      return left.id.localeCompare(right.id);
    })
    .map((flashback) => ({
      id: flashback.id,
      memoryId: flashback.memoryId,
      text: flashback.text,
      prefix: flashback.prefix,
      suffix: flashback.suffix,
      startOffset: flashback.startOffset,
      endOffset: flashback.endOffset,
      contentHash: flashback.contentHash,
      createdAt: flashback.createdAt.toISOString(),
      updatedAt: flashback.updatedAt.toISOString(),
    }));

  if (input.variant.kind === "source") {
    return {
      version: 1,
      memoryId: input.memoryId,
      flashbacks,
    };
  }

  return {
    version: 2,
    memoryId: input.memoryId,
    variant: {
      kind: input.variant.kind,
      langCode: input.variant.langCode,
      translationOutputHash: input.variant.outputHash,
    },
    flashbacks,
  };
}
