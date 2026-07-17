import { TranslationOutputValidationError } from "./errors";

export const DEFAULT_TRANSLATION_CHUNK_CONFIG = {
  maxBlocks: 80,
  maxRetries: 3,
  maxRoughTokens: 2500,
  minLengthRatio: 0.35,
  maxLengthRatio: 2.8,
  softRoughTokens: 1800,
} as const;

export const BRILLIANT_MAX_TRANSLATION_PROMPT_BYTES = 64 * 1_024;
export const BRILLIANT_MAX_TRANSLATION_SOURCE_BYTES = 20 * 1_024 * 1_024;
export const BRILLIANT_MAX_TRANSLATION_SEGMENTS = 16_384;
export const BRILLIANT_MAX_TRANSLATION_CHUNKS = 4_096;

export interface TranslationWorkloadLimits {
  maxChunks: number;
  maxSegments: number;
  maxSourceBytes: number;
}

export const DEFAULT_TRANSLATION_WORKLOAD_LIMITS: TranslationWorkloadLimits =
  Object.freeze({
    maxChunks: BRILLIANT_MAX_TRANSLATION_CHUNKS,
    maxSegments: BRILLIANT_MAX_TRANSLATION_SEGMENTS,
    maxSourceBytes: BRILLIANT_MAX_TRANSLATION_SOURCE_BYTES,
  });

export function assertTranslationSourceAdmission(
  sourceBytes: number,
  limits: TranslationWorkloadLimits,
): void {
  if (sourceBytes <= limits.maxSourceBytes) {
    return;
  }
  throw new TranslationOutputValidationError(
    "Translation source exceeds the total source byte limit.",
    { retryable: false },
  );
}

export function assertTranslationManifestAdmission(
  input: { chunkCount: number; segmentCount: number },
  limits: TranslationWorkloadLimits,
): void {
  if (input.segmentCount > limits.maxSegments) {
    throw new TranslationOutputValidationError(
      "Translation manifest exceeds the total segment count limit.",
      { retryable: false },
    );
  }
  if (input.chunkCount > limits.maxChunks) {
    throw new TranslationOutputValidationError(
      "Translation manifest exceeds the total chunk count limit.",
      { retryable: false },
    );
  }
}
