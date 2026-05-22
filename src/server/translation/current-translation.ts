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
}): Promise<CurrentTranslationResult> {
  const source = await loadTranslationSourceSnapshot(input);
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
  if (
    job.promptPolicyVersion !== BRILLIANT_PROMPT_POLICY_VERSION ||
    job.chunkerVersion !== BRILLIANT_CHUNKER_VERSION
  ) {
    return {
      status: "unavailable",
      job,
      reason: "policy_version_mismatch",
      sourceHash: source.sourceHash,
    };
  }

  const expectedPath = resolveTranslatedMemoryContentPath(input);
  if (job.outputPath !== expectedPath.relativePath) {
    return {
      status: "unavailable",
      job,
      reason: "output_missing",
      sourceHash: source.sourceHash,
    };
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(expectedPath.absolutePath);
  } catch {
    return {
      status: "unavailable",
      job,
      reason: "output_missing",
      sourceHash: source.sourceHash,
    };
  }

  const outputHash = createSha256ContentHash(bytes);
  if (outputHash !== job.outputHash) {
    return {
      status: "unavailable",
      job,
      reason: "output_hash_mismatch",
      sourceHash: source.sourceHash,
    };
  }

  return {
    status: "current",
    job,
    outputHash,
    outputPath: expectedPath.relativePath,
    readerUrl: createTranslatedReaderUrl(input),
    sourceHash: source.sourceHash,
  };
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
