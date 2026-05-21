import {
  SUPPORTED_TRANSLATION_LANGUAGES,
  type SupportedLanguageCode,
} from "./languages";
import type { CodexChunkOutput, TranslationChunk } from "./types";

export const BRILLIANT_PROMPT_POLICY_VERSION = "brilliant-v1";
export const BRILLIANT_CHUNKER_VERSION = "chunker-v1";

export function buildTranslationPrompt(input: {
  chunk: TranslationChunk;
  targetLanguage: SupportedLanguageCode;
}): string {
  const language = SUPPORTED_TRANSLATION_LANGUAGES.find(
    (candidate) => candidate.code === input.targetLanguage,
  );
  const targetLabel = language === undefined
    ? input.targetLanguage
    : `${language.displayName} (${language.nativeName})`;

  return [
    "You are a faithful article translation worker for TRAUMA Brilliant.",
    `Translate the Markdown blocks into ${targetLabel}.`,
    "Preserve Markdown structure, block ids, code, math, URLs, citations, footnotes, HTML tags, file paths, commands, and placeholders.",
    "Return only JSON that matches the requested schema. Do not add commentary.",
    "",
    JSON.stringify({
      chunk_index: input.chunk.chunkIndex,
      document_type: input.chunk.documentType,
      source_url: input.chunk.sourceUrl,
      title: input.chunk.docTitle,
      blocks: input.chunk.blockIds.map((blockId) => ({
        id: blockId,
      })),
      markdown: input.chunk.sourceMarkdown,
    }),
  ].join("\n");
}

export function createCodexChunkOutputSchema(chunk: TranslationChunk) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["chunk_index", "blocks", "warnings"],
    properties: {
      chunk_index: {
        const: chunk.chunkIndex,
      },
      blocks: {
        type: "array",
        minItems: chunk.blockIds.length,
        maxItems: chunk.blockIds.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "translated_markdown"],
          properties: {
            id: { type: "string" },
            translated_markdown: { type: "string" },
          },
        },
      },
      warnings: {
        type: "array",
        items: { type: "string" },
      },
    },
  } as const;
}

export function validateCodexChunkOutput(input: {
  chunk: TranslationChunk;
  output: unknown;
}): CodexChunkOutput {
  if (!isRecord(input.output)) {
    throw new TranslationOutputValidationError("Codex output must be an object.");
  }
  if (input.output.chunk_index !== input.chunk.chunkIndex) {
    throw new TranslationOutputValidationError("Codex output chunk_index mismatch.");
  }
  if (!Array.isArray(input.output.blocks)) {
    throw new TranslationOutputValidationError("Codex output blocks must be an array.");
  }
  if (input.output.blocks.length !== input.chunk.blockIds.length) {
    throw new TranslationOutputValidationError("Codex output block count mismatch.");
  }
  if (
    !Array.isArray(input.output.warnings) ||
    !input.output.warnings.every((warning) => typeof warning === "string")
  ) {
    throw new TranslationOutputValidationError("Codex output warnings must be strings.");
  }

  const blocks = input.output.blocks.map((block, index) => {
    if (!isRecord(block)) {
      throw new TranslationOutputValidationError("Codex output block must be an object.");
    }
    const expectedId = input.chunk.blockIds[index];
    if (expectedId === undefined) {
      throw new TranslationOutputValidationError(
        `Codex output block id is missing at ${index}.`,
      );
    }
    if (block.id !== expectedId) {
      throw new TranslationOutputValidationError(
        `Codex output block id mismatch at ${index}.`,
      );
    }
    if (typeof block.translated_markdown !== "string") {
      throw new TranslationOutputValidationError(
        `Codex output block ${expectedId} translated_markdown must be a string.`,
      );
    }
    if (block.translated_markdown.trim() === "") {
      throw new TranslationOutputValidationError(
        `Codex output block ${expectedId} translated_markdown is empty.`,
      );
    }
    return {
      id: expectedId,
      translated_markdown: block.translated_markdown,
    };
  });

  return {
    chunk_index: input.chunk.chunkIndex,
    blocks,
    warnings: input.output.warnings,
  };
}

export function stringifyCodexChunkOutput(output: CodexChunkOutput): string {
  return output.blocks.map((block) => block.translated_markdown).join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class TranslationOutputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranslationOutputValidationError";
  }
}
