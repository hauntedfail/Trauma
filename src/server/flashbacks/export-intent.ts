import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import type { ResolvedTraumaConfig } from "../config";
import type {
  FlashbackRepository,
  MemoryRepository,
  TranslationRepository,
} from "../db";
import {
  publishFileAtomically,
  syncDirectoryBestEffort,
} from "../files/atomic-write";
import {
  withMemoryOperationRecoveryLease,
} from "../memories/operation-coordination";
import { resolveMemoryContentPath } from "../store/memory-content";
import { MEMORY_OPERATION_JOURNAL_DIRECTORY } from "../store/internal-directories";
import { resolveCurrentTranslationReadOnly } from "../translation/current-translation";
import {
  isSupportedLanguageCode,
} from "../translation/languages";
import { resolveTranslatedMemoryContentPath } from "../translation/paths";
import { reconcileFlashbackMetadataExport } from "./reconciliation";
import type { FlashbackMetadataExportFileSystem } from "./export";
import type { FlashbackVariant } from "./variant";

const FLASHBACK_EXPORT_INTENT_DIRECTORY = "flashback-exports";
const FLASHBACK_EXPORT_INTENT_VERSION = 1;

export interface FlashbackExportReconciliationIntent {
  version: 1;
  kind: "flashback_export_reconciliation";
  memoryId: string;
  variant: FlashbackVariant;
}

type RecoveryRepositories = {
  flashbacks: Pick<FlashbackRepository, "listForMemoryVariant">;
  memories: Pick<MemoryRepository, "findById">;
  translations: TranslationRepository;
};

const recoveryByStorePath = new Map<string, Promise<number>>();

export async function persistFlashbackExportReconciliationIntent(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  memoryId: string;
  variant: FlashbackVariant;
}): Promise<void> {
  const intent = createIntent(input);
  const finalPath = resolveIntentPath(input.config, intent);
  const directoryPath = dirname(finalPath);
  await assertExistingJournalOwnership(input.config.storePath, directoryPath);
  await createDirectoryHierarchyDurably(directoryPath);
  await assertJournalOwnership(input.config.storePath, directoryPath);
  await publishFileAtomically(
    finalPath,
    `${JSON.stringify(intent, null, 2)}\n`,
  );
}

export async function clearFlashbackExportReconciliationIntent(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  memoryId: string;
  variant: FlashbackVariant;
}): Promise<void> {
  const intent = createIntent(input);
  const finalPath = resolveIntentPath(input.config, intent);
  const directoryPath = dirname(finalPath);
  try {
    await assertJournalOwnership(input.config.storePath, directoryPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  await rm(finalPath, { force: true });
  await syncDirectoryBestEffort(directoryPath);
}

export async function recoverFlashbackExportReconciliationIntents(input: {
  beforeWrite?: (intent: FlashbackExportReconciliationIntent) => Promise<void> | void;
  config: Pick<ResolvedTraumaConfig, "storePath">;
  fileSystem?: FlashbackMetadataExportFileSystem;
  repositories: RecoveryRepositories;
}): Promise<number> {
  const storePath = resolve(input.config.storePath);
  const existing = recoveryByStorePath.get(storePath);
  if (existing !== undefined) {
    return existing;
  }

  const recovery = withMemoryOperationRecoveryLease(
    storePath,
    () => recoverFlashbackExportReconciliationIntentsUnlocked(input),
  ).finally(() => {
    if (recoveryByStorePath.get(storePath) === recovery) {
      recoveryByStorePath.delete(storePath);
    }
  });
  recoveryByStorePath.set(storePath, recovery);
  return recovery;
}

async function recoverFlashbackExportReconciliationIntentsUnlocked(input: {
  beforeWrite?: (intent: FlashbackExportReconciliationIntent) => Promise<void> | void;
  config: Pick<ResolvedTraumaConfig, "storePath">;
  fileSystem?: FlashbackMetadataExportFileSystem;
  repositories: RecoveryRepositories;
}): Promise<number> {
  const directoryPath = resolveIntentDirectory(input.config.storePath);
  let entries;
  try {
    await assertJournalOwnership(input.config.storePath, directoryPath);
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }

  let recovered = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const path = join(directoryPath, entry.name);
    const intent = parseIntent(JSON.parse(await readFile(path, "utf8")) as unknown);
    if (entry.name !== resolveIntentFilename(intent)) {
      throw new Error(
        "Flashback export reconciliation intent filename does not match its payload.",
      );
    }

    const memory = await input.repositories.memories.findById(intent.memoryId);
    if (memory === undefined) {
      await clearFlashbackExportReconciliationIntent({
        config: input.config,
        memoryId: intent.memoryId,
        variant: intent.variant,
      });
      recovered += 1;
      continue;
    }

    const translationVariant = intent.variant.kind === "translation"
      ? intent.variant
      : undefined;
    const written = await reconcileFlashbackMetadataExport({
      beforeWrite: () => input.beforeWrite?.(intent),
      config: input.config,
      fileSystem: input.fileSystem,
      flashbacks: input.repositories.flashbacks,
      memoryId: intent.memoryId,
      resolveAuthoritativeVariant: translationVariant === undefined
        ? undefined
        : async () => {
          const current = await resolveCurrentTranslationReadOnly({
            config: input.config,
            langCode: translationVariant.langCode,
            memoryId: intent.memoryId,
            repository: input.repositories.translations,
          });
          if (current.status !== "current") {
            return undefined;
          }
          return {
            kind: "translation" as const,
            langCode: translationVariant.langCode,
            outputHash: current.outputHash,
          };
        },
      variant: intent.variant,
      writeEmptyIfMissing: true,
    });
    if (written === undefined && intent.variant.kind === "translation") {
      // No translation currently owns this language projection. The obsolete
      // intent must not recreate a stale export for an unavailable variant.
      await clearFlashbackExportReconciliationIntent({
        config: input.config,
        memoryId: intent.memoryId,
        variant: intent.variant,
      });
      recovered += 1;
      continue;
    }
    if (written === undefined) {
      throw new Error("Flashback export reconciliation did not publish its source intent.");
    }
    await clearFlashbackExportReconciliationIntent({
      config: input.config,
      memoryId: intent.memoryId,
      variant: intent.variant,
    });
    recovered += 1;
  }
  return recovered;
}

function createIntent(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  memoryId: string;
  variant: FlashbackVariant;
}): FlashbackExportReconciliationIntent {
  validateVariant(input.config, input.memoryId, input.variant);
  return {
    version: FLASHBACK_EXPORT_INTENT_VERSION,
    kind: "flashback_export_reconciliation",
    memoryId: input.memoryId,
    variant: input.variant,
  };
}

function parseIntent(value: unknown): FlashbackExportReconciliationIntent {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) =>
      !["version", "kind", "memoryId", "variant"].includes(key)
    ) ||
    value.version !== FLASHBACK_EXPORT_INTENT_VERSION ||
    value.kind !== "flashback_export_reconciliation" ||
    typeof value.memoryId !== "string" ||
    !isRecord(value.variant)
  ) {
    throw new Error("Invalid Flashback export reconciliation intent.");
  }
  const variant = value.variant;
  if (variant.kind === "source" && Object.keys(variant).length === 1) {
    resolveMemoryContentPath({ storePath: "." }, value.memoryId);
    return {
      version: 1,
      kind: "flashback_export_reconciliation",
      memoryId: value.memoryId,
      variant: { kind: "source" },
    };
  }
  if (
    variant.kind !== "translation" ||
    Object.keys(variant).some((key) => !["kind", "langCode", "outputHash"].includes(key)) ||
    typeof variant.langCode !== "string" ||
    !isSupportedLanguageCode(variant.langCode) ||
    typeof variant.outputHash !== "string" ||
    variant.outputHash.length === 0 ||
    variant.outputHash.length > 1024
  ) {
    throw new Error("Invalid Flashback export reconciliation variant.");
  }
  resolveMemoryContentPath({ storePath: "." }, value.memoryId);
  return {
    version: 1,
    kind: "flashback_export_reconciliation",
    memoryId: value.memoryId,
    variant: {
      kind: "translation",
      langCode: variant.langCode,
      outputHash: variant.outputHash,
    },
  };
}

function validateVariant(
  config: Pick<ResolvedTraumaConfig, "storePath">,
  memoryId: string,
  variant: FlashbackVariant,
): void {
  resolveMemoryContentPath(config, memoryId);
  if (variant.kind === "translation") {
    resolveTranslatedMemoryContentPath({
      config,
      langCode: variant.langCode,
      memoryId,
    });
    if (variant.outputHash.length === 0 || variant.outputHash.length > 1024) {
      throw new Error("Invalid Flashback translation output hash.");
    }
  }
}

function resolveIntentPath(
  config: Pick<ResolvedTraumaConfig, "storePath">,
  intent: FlashbackExportReconciliationIntent,
): string {
  return resolve(
    resolveIntentDirectory(config.storePath),
    resolveIntentFilename(intent),
  );
}

function resolveIntentDirectory(storePath: string): string {
  return resolve(
    storePath,
    MEMORY_OPERATION_JOURNAL_DIRECTORY,
    FLASHBACK_EXPORT_INTENT_DIRECTORY,
  );
}

function resolveIntentFilename(intent: FlashbackExportReconciliationIntent): string {
  if (intent.variant.kind === "source") {
    return `${intent.memoryId}.source.json`;
  }
  const outputHashKey = createHash("sha256")
    .update(intent.variant.outputHash, "utf8")
    .digest("hex");
  return `${intent.memoryId}.translation-${intent.variant.langCode}-${outputHashKey}.json`;
}

async function createDirectoryHierarchyDurably(directoryPath: string): Promise<void> {
  const firstCreatedDirectory = await mkdir(directoryPath, { recursive: true });
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
    throw new Error("Created Flashback intent directory escaped its hierarchy.");
  }
  await syncDirectoryBestEffort(dirname(firstCreated));
  let parent = firstCreated;
  for (const segment of descendants.split(sep).filter(Boolean)) {
    await syncDirectoryBestEffort(parent);
    parent = join(parent, segment);
  }
}

async function assertExistingJournalOwnership(
  storePath: string,
  directoryPath: string,
): Promise<void> {
  const effectiveStorePath = await realpathIfPresent(storePath);
  if (effectiveStorePath === undefined) {
    return;
  }
  const operationPath = resolve(storePath, MEMORY_OPERATION_JOURNAL_DIRECTORY);
  const effectiveOperationPath = await realpathIfPresent(operationPath);
  if (effectiveOperationPath !== undefined) {
    assertContainedPath(effectiveStorePath, effectiveOperationPath);
  }
  const effectiveDirectoryPath = await realpathIfPresent(directoryPath);
  if (effectiveDirectoryPath !== undefined) {
    assertContainedPath(effectiveStorePath, effectiveDirectoryPath);
  }
}

async function assertJournalOwnership(
  storePath: string,
  directoryPath: string,
): Promise<void> {
  const [effectiveStorePath, effectiveDirectoryPath] = await Promise.all([
    realpath(storePath),
    realpath(directoryPath),
  ]);
  assertContainedPath(effectiveStorePath, effectiveDirectoryPath);
}

function assertContainedPath(ownerPath: string, candidatePath: string): void {
  const relativePath = relative(ownerPath, candidatePath);
  if (
    relativePath === "" ||
    isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`)
  ) {
    throw new Error("Flashback intent path escaped storePath.");
  }
}

async function realpathIfPresent(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
