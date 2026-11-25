import type { APIEvent } from "@solidjs/start/server";

import { getLengthBucket } from "../../components/memories/browse-data";
import {
  loadRuntimeTraumaConfig,
  type ResolvedTraumaConfig,
} from "../config";
import { authenticateApiRequest } from "../http/api-auth";
import { formatConfigError, jsonResponse } from "../http/json";
import { loadReaderMemory } from "../reader/page-data";
import {
  readMemoryContent,
  readResolvedMemoryContent,
} from "../store";
import {
  isSupportedLanguageCode,
  type SupportedLanguageCode,
} from "../translation/languages";
import { resolveTranslatedMemoryContentPath } from "../translation/paths";
import { agentErrorResponse, extractDomain } from "./helpers";
import type { AgentMemoryReadingStateResponse } from "./types";

export interface AgentMemoryHandlerDependencies {
  config?: ResolvedTraumaConfig;
  loadReaderMemory?: typeof loadReaderMemory;
}

export function createAgentMemoryHandler(
  deps: AgentMemoryHandlerDependencies = {},
) {
  return async function getAgentMemory(event: APIEvent): Promise<Response> {
    return handleAgentMemoryRequest(event, deps);
  };
}

export async function handleAgentMemoryRequest(
  event: APIEvent,
  deps: AgentMemoryHandlerDependencies = {},
): Promise<Response> {
  const auth = authenticateApiRequest(event.request);
  if (!auth.ok) {
    return agentErrorResponse(auth.error, auth.status);
  }

  const memoryId = event.params.memoryId?.trim();
  if (memoryId === undefined || memoryId === "") {
    return agentErrorResponse("memoryId must be a non-empty string", 400);
  }

  const rawLang = new URL(event.request.url).searchParams.get("lang")?.trim();
  let langCode: SupportedLanguageCode | undefined;
  if (rawLang !== undefined && rawLang !== "") {
    if (!isSupportedLanguageCode(rawLang)) {
      return agentErrorResponse(
        "lang must be a supported translation language",
        400,
      );
    }
    langCode = rawLang;
  }

  let config: ResolvedTraumaConfig;
  try {
    config = deps.config ?? loadRuntimeTraumaConfig();
  } catch (error) {
    return agentErrorResponse(formatConfigError(error), 500);
  }

  const result = await (deps.loadReaderMemory ?? loadReaderMemory)(memoryId, {
    config,
    ...(langCode === undefined ? {} : { langCode }),
  });

  if (result.status !== "ready") {
    if (result.status === "not_found") {
      return agentErrorResponse("memory was not found", 404);
    }
    if (result.status === "content_missing") {
      return agentErrorResponse(result.message, 404, {
        code: "content_missing",
      });
    }
    return agentErrorResponse(result.message, 503, {
      code: "unavailable",
    });
  }

  const markdown = await readVariantMarkdown({
    config,
    langCode,
    memoryId,
  });

  const { memory, content, rendered } = result;
  const response: AgentMemoryReadingStateResponse = {
    id: memory.id,
    url: memory.url,
    domain: extractDomain(memory.url),
    title: memory.title,
    description: memory.description,
    faviconUrl: memory.faviconUrl,
    extractionStatus: memory.extractionStatus,
    read: memory.read,
    triageState: memory.triageState ?? "shelf",
    triageChangedAt: memory.triageChangedAt?.toISOString() ?? null,
    lastPosition: memory.lastPosition ?? null,
    lastOpenedAt: memory.lastOpenedAt?.toISOString() ?? null,
    wordCount: memory.wordCount ?? null,
    lengthBucket: getLengthBucket(memory.wordCount),
    capturedAt: memory.createdAt.toISOString(),
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
    categories: memory.categories,
    tags: memory.tags,
    activeVariant: {
      kind: langCode === undefined ? "source" : "translation",
      langCode: langCode ?? null,
      relativePath: content.relativePath,
    },
    variants: content.variants,
    markdown,
    toc: rendered.toc,
    flashbacks: memory.flashbacks,
    moments: memory.moments,
  };

  return jsonResponse(response, { status: 200 });
}

async function readVariantMarkdown(input: {
  config: ResolvedTraumaConfig;
  langCode?: SupportedLanguageCode;
  memoryId: string;
}): Promise<string> {
  if (input.langCode === undefined) {
    const source = await readMemoryContent({
      config: input.config,
      memoryId: input.memoryId,
    });
    return source.markdown;
  }

  const translated = await readResolvedMemoryContent(
    resolveTranslatedMemoryContentPath({
      config: input.config,
      langCode: input.langCode,
      memoryId: input.memoryId,
    }),
  );
  return translated.markdown;
}
