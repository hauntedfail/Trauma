import { readFile } from "node:fs/promises";

import type { ResolvedTraumaConfig } from "../config";
import type {
  TranslationJobRecord,
  TranslationRepository,
} from "../db/repositories";
import { createSha256ContentHash } from "./hash";
import { resolveTranslatedMemoryContentPath, createTranslatedReaderUrl } from "./paths";
import {
  BRILLIANT_CHUNKER_VERSION,
  BRILLIANT_PROMPT_POLICY_VERSION,
} from "./prompt";
import { loadTranslationSourceSnapshot } from "./source-loader";
import type {
  TranslationSourceSnapshot,
  TranslationUnavailableReason,
} from "./types";
import type { SupportedLanguageCode } from "./languages";

export type CurrentTranslationResult =
  | {
      status: "current";
      job: TranslationJobRecord;
      outputHash: string;
      outputPath: string;
      readerUrl: string;
      sourceHash: string;
    }
  | {
      status: "missing";
      sourceHash: string;
    }
  | {
      status: "unavailable";
      job: TranslationJobRecord;
      reason: TranslationUnavailableReason;
      sourceHash: string;
    };

export async function resolveCurrentTranslationReadOnly(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  langCode: SupportedLanguageCode;
  memoryId: string;
  repository: TranslationRepository;
  sourceSnapshot?: TranslationSourceSnapshot;
}): Promise<CurrentTranslationResult> {
  const source = input.sourceSnapshot ?? await loadTranslationSourceSnapshot(input);
  const job = await input.repository.findCompleteTranslationRecord(
    input.memoryId,
    input.langCode,
    source.sourceHash,
  );
  if (job === null) {
    return {
      status: "missing",
      sourceHash: source.sourceHash,
    };
  }

  return resolveCompleteTranslationRecordReadOnly({
    config: input.config,
    job,
    langCode: input.langCode,
    memoryId: input.memoryId,
    sourceSnapshot: source,
  });
}

export async function resolveCompleteTranslationRecordReadOnly(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  langCode: SupportedLanguageCode;
  memoryId: string;
  job: TranslationJobRecord;
  sourceSnapshot: TranslationSourceSnapshot;
}): Promise<CurrentTranslationResult> {
  if (input.job.sourceHash !== input.sourceSnapshot.sourceHash) {
    return {
      status: "missing",
      sourceHash: input.sourceSnapshot.sourceHash,
    };
  }

  if (
    input.job.promptPolicyVersion !== BRILLIANT_PROMPT_POLICY_VERSION ||
    input.job.chunkerVersion !== BRILLIANT_CHUNKER_VERSION
  ) {
    return {
      status: "unavailable",
      job: input.job,
      reason: "policy_version_mismatch",
      sourceHash: input.sourceSnapshot.sourceHash,
    };
  }

  const expectedPath = resolveTranslatedMemoryContentPath(input);
  if (input.job.outputPath !== expectedPath.relativePath) {
    return {
      status: "unavailable",
      job: input.job,
      reason: "output_missing",
      sourceHash: input.sourceSnapshot.sourceHash,
    };
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(expectedPath.absolutePath);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
    return {
      status: "unavailable",
      job: input.job,
      reason: "output_missing",
      sourceHash: input.sourceSnapshot.sourceHash,
    };
  }

  const outputHash = createSha256ContentHash(bytes);
  if (outputHash !== input.job.outputHash) {
    return {
      status: "unavailable",
      job: input.job,
      reason: "output_hash_mismatch",
      sourceHash: input.sourceSnapshot.sourceHash,
    };
  }

  return {
    status: "current",
    job: input.job,
    outputHash,
    outputPath: expectedPath.relativePath,
    readerUrl: createTranslatedReaderUrl(input),
    sourceHash: input.sourceSnapshot.sourceHash,
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export async function repairUnavailableTranslation(input: {
  jobId: string;
  now?: Date;
  reason: TranslationUnavailableReason;
  repository: TranslationRepository;
}): Promise<void> {
  await input.repository.markTranslationUnavailable(
    input.jobId,
    input.reason,
    input.now ?? new Date(),
  );
}
