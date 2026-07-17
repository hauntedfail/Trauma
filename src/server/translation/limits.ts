export const DEFAULT_TRANSLATION_CHUNK_CONFIG = {
  maxBlocks: 80,
  maxRetries: 3,
  maxRoughTokens: 2500,
  minLengthRatio: 0.35,
  maxLengthRatio: 2.8,
  softRoughTokens: 1800,
} as const;

export const BRILLIANT_MAX_TRANSLATION_PROMPT_BYTES = 64 * 1_024;
