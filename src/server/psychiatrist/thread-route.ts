import type { APIEvent } from "@solidjs/start/server";
import { randomBytes } from "node:crypto";

import {
  loadRuntimeTraumaConfig,
  type ResolvedTraumaConfig,
} from "../config";
import { initializeDatabase } from "../db";
import { jsonResponse } from "../http/json";
import { PSYCHIATRIST_PROMPT_POLICY_VERSION } from "./prompt";
import {
  buildPsychiatristMemoryContext,
  PsychiatristContextError,
} from "./context";
import { activePsychiatristTurns } from "./active-turns";
import {
  createPsychiatristThread,
  findLatestPsychiatristThread,
  loadPsychiatristThread,
  PsychiatristThreadStoreError,
  reconcileInactivePsychiatristTurns,
} from "./thread-store";
import type {
  PsychiatristMemoryContext,
  PsychiatristThreadManifest,
  PsychiatristThreadPair,
} from "./types";

type BuildContext = typeof buildPsychiatristMemoryContext;
type CreateThread = typeof createPsychiatristThread;
type FindLatestThread = typeof findLatestPsychiatristThread;
type LoadThread = typeof loadPsychiatristThread;

type ThreadPayload =
  | { ok: true; langCode?: string; resumeLatest: boolean }
  | { ok: false; message: string };

export function createStartPsychiatristThreadHandler(input: {
  buildContext?: BuildContext;
  config?: Pick<ResolvedTraumaConfig, "storePath">;
  createThread?: CreateThread;
  findLatestThread?: FindLatestThread;
  generateId?: () => string;
  now?: () => Date;
} = {}) {
  return async function startPsychiatristThread(event: APIEvent): Promise<Response> {
    return handleStartPsychiatristThreadRequest(event, input);
  };
}

export function createReadPsychiatristThreadHandler(input: {
  config?: Pick<ResolvedTraumaConfig, "storePath">;
  loadThread?: LoadThread;
} = {}) {
  return async function readPsychiatristThread(event: APIEvent): Promise<Response> {
    return handleReadPsychiatristThreadRequest(event, input);
  };
}

export async function handleStartPsychiatristThreadRequest(
  event: APIEvent,
  input: {
    buildContext?: BuildContext;
    config?: Pick<ResolvedTraumaConfig, "storePath">;
    createThread?: CreateThread;
    findLatestThread?: FindLatestThread;
    generateId?: () => string;
    now?: () => Date;
  } = {},
): Promise<Response> {
  const memoryId = event.params.memoryId?.trim();
  if (memoryId === undefined || memoryId === "") {
    return safeErrorResponse("invalid_request", "memoryId must be a non-empty string.", 400);
  }
  const payload = await parseThreadPayload(event.request);
  if (!payload.ok) {
    return safeErrorResponse("invalid_request", payload.message, 400);
  }

  const config = input.config ?? loadRuntimeTraumaConfig();
  let connection: ReturnType<typeof initializeDatabase> | undefined;
  try {
    let context: PsychiatristMemoryContext;
    if (input.buildContext === undefined) {
      connection = initializeDatabase(config as ResolvedTraumaConfig);
      context = await buildPsychiatristMemoryContext({
        config,
        langCode: payload.langCode,
        memoryId,
        memoryRepository: connection.repositories.memories,
        translationRepository: connection.repositories.translations,
      });
    } else {
      context = await input.buildContext({
        config,
        langCode: payload.langCode,
        memoryId,
        memoryRepository: undefined as never,
        translationRepository: undefined as never,
      });
    }

    const now = (input.now?.() ?? new Date()).toISOString();
    if (payload.resumeLatest) {
      const latest = await (input.findLatestThread ?? findLatestPsychiatristThread)({
        activeContentHash: context.contentHash,
        config,
        langCode: context.langCode,
        memoryId: context.memoryId,
        policyVersion: PSYCHIATRIST_PROMPT_POLICY_VERSION,
        variantKind: context.variantKind,
      });
      if (latest !== undefined) {
        const thread = input.findLatestThread === undefined
          ? await reconcileThreadForResponse({
            config,
            loadThread: loadPsychiatristThread,
            thread: latest,
          })
          : latest;
        return jsonResponse(toThreadResponse(thread), { status: 200 });
      }
    }
    const manifest: PsychiatristThreadManifest = {
      activeContentHash: context.contentHash,
      createdAt: now,
      ...(context.langCode === undefined ? {} : { langCode: context.langCode }),
      memoryId: context.memoryId,
      policyVersion: PSYCHIATRIST_PROMPT_POLICY_VERSION,
      sourceHash: context.sourceHash,
      status: "ready",
      threadId: input.generateId?.() ?? generateUuidV7Like(),
      ...(context.variantKind === "translation"
        ? { translationOutputHash: context.contentHash }
        : {}),
      updatedAt: now,
      variantKind: context.variantKind,
    };
    await (input.createThread ?? createPsychiatristThread)({
      config,
      manifest,
    });
    return jsonResponse(toThreadResponse({ manifest, pairs: [] }), { status: 201 });
  } catch (error) {
    return formatPsychiatristThreadError(error);
  } finally {
    connection?.close();
  }
}

export async function handleReadPsychiatristThreadRequest(
  event: APIEvent,
  input: {
    config?: Pick<ResolvedTraumaConfig, "storePath">;
    loadThread?: LoadThread;
  } = {},
): Promise<Response> {
  const threadId = event.params.threadId?.trim();
  if (threadId === undefined || threadId === "") {
    return safeErrorResponse("invalid_request", "threadId must be a non-empty string.", 400);
  }
  const config = input.config ?? loadRuntimeTraumaConfig();
  try {
    const loadThread = input.loadThread ?? loadPsychiatristThread;
    let thread = await loadThread({
      config,
      threadId,
    });
    if (input.loadThread === undefined) {
      thread = await reconcileThreadForResponse({ config, loadThread, thread });
    }
    return jsonResponse(toThreadResponse(thread), { status: 200 });
  } catch (error) {
    return formatPsychiatristThreadError(error);
  }
}

async function reconcileThreadForResponse(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  loadThread: LoadThread;
  thread: {
    manifest: PsychiatristThreadManifest;
    pairs: PsychiatristThreadPair[];
  };
}): Promise<{
  manifest: PsychiatristThreadManifest;
  pairs: PsychiatristThreadPair[];
}> {
  const threadId = input.thread.manifest.threadId;
  const activeTurn = activePsychiatristTurns.getByThreadId(threadId);
  if (activeTurn === undefined && activePsychiatristTurns.hasActiveOrReservedThread(threadId)) {
    return input.thread;
  }
  const changed = await reconcileInactivePsychiatristTurns({
    activeTurnIds: activeTurn === undefined ? [] : [activeTurn.turnId],
    config: input.config,
    threadId,
  });
  return changed
    ? input.loadThread({ config: input.config, threadId })
    : input.thread;
}

async function parseThreadPayload(request: Request): Promise<ThreadPayload> {
  const rawBody = await request.text();
  if (rawBody.trim() === "") {
    return { ok: true, resumeLatest: true };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { ok: false, message: "request body must be JSON." };
  }
  if (!isRecord(payload)) {
    return { ok: false, message: "request body must be an object." };
  }
  const allowedKeys = new Set(["lang_code", "resume_latest"]);
  if (!Object.keys(payload).every((key) => allowedKeys.has(key))) {
    return {
      ok: false,
      message: "request body must contain only lang_code and resume_latest.",
    };
  }
  let langCode: string | undefined;
  if (Object.hasOwn(payload, "lang_code")) {
    if (typeof payload.lang_code !== "string" || payload.lang_code.trim() === "") {
      return {
        ok: false,
        message: "lang_code must be a non-empty string when provided.",
      };
    }
    langCode = payload.lang_code.trim();
  }
  let resumeLatest = true;
  if (Object.hasOwn(payload, "resume_latest")) {
    if (typeof payload.resume_latest !== "boolean") {
      return {
        ok: false,
        message: "resume_latest must be a boolean when provided.",
      };
    }
    resumeLatest = payload.resume_latest;
  }
  return { ok: true, langCode, resumeLatest };
}

function toThreadResponse(input: {
  manifest: PsychiatristThreadManifest;
  pairs: PsychiatristThreadPair[];
}) {
  const activeTurn = activePsychiatristTurns.getByThreadId(input.manifest.threadId);
  return {
    active_turn: activeTurn === undefined
      ? null
      : {
        event_url: `/api/psychiatrist-turns/${activeTurn.turnId}/events`,
        pair_id: activeTurn.pairId,
        status: "running",
        turn_id: activeTurn.turnId,
      },
    content_hash: input.manifest.activeContentHash,
    lang_code: input.manifest.langCode ?? null,
    memory_id: input.manifest.memoryId,
    pairs: input.pairs.map((pair) => ({
      pair_id: pair.pairId,
      ...(pair.retryAction === undefined ? {} : { retry_action: pair.retryAction }),
      ...(pair.retryMode === undefined ? {} : { retry_mode: pair.retryMode }),
      ...(pair.retryTurnId === undefined ? {} : { retry_turn_id: pair.retryTurnId }),
      status: pair.status,
      turn_id: pair.turnId,
      user_prompt: {
        content: pair.user.content,
        created_at: pair.user.createdAt,
      },
      ...(pair.assistant === undefined
        ? {}
        : {
          assistant_response: {
            completed_at: pair.assistant.completedAt,
            content: pair.assistant.content,
            source_citations: pair.assistant.citations.map((citation) => ({
              source_id: citation.sourceId,
              title: citation.title,
              url: citation.url,
            })),
          },
        }),
    })),
    status: input.manifest.status,
    thread_id: input.manifest.threadId,
    variant_kind: input.manifest.variantKind,
  };
}

function formatPsychiatristThreadError(error: unknown): Response {
  if (error instanceof PsychiatristContextError) {
    return safeErrorResponse(
      error.code,
      error.code === "missing_memory"
        ? "Memory was not found."
        : "Psychiatrist context is unavailable for this memory.",
      error.code === "missing_memory" ? 404 : 409,
    );
  }
  if (error instanceof PsychiatristThreadStoreError) {
    return safeErrorResponse(
      error.code === "thread_not_found" ? "thread_not_found" : "invalid_request",
      error.code === "thread_not_found"
        ? "Psychiatrist thread was not found."
        : "Psychiatrist thread request is invalid.",
      error.code === "thread_not_found" ? 404 : 400,
    );
  }
  return safeErrorResponse("unknown", "Psychiatrist thread request failed.", 500);
}

function safeErrorResponse(
  code: string,
  message: string,
  status: number,
): Response {
  return jsonResponse(
    {
      action: code === "thread_not_found" || code === "missing_memory"
        ? "open_reader"
        : "retry",
      code,
      message,
      status: "error",
    },
    { status },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function generateUuidV7Like(): string {
  const now = BigInt(Date.now());
  const random = randomBytes(10);
  const timestamp = now.toString(16).padStart(12, "0").slice(-12);
  const randomHex = random.toString("hex");
  return [
    timestamp.slice(0, 8),
    timestamp.slice(8, 12),
    `7${randomHex.slice(0, 3)}`,
    `${((Number.parseInt(randomHex.slice(3, 5), 16) & 0x3f) | 0x80)
      .toString(16)
      .padStart(2, "0")}${randomHex.slice(5, 7)}`,
    randomHex.slice(7, 19).padEnd(12, "0"),
  ].join("-");
}
