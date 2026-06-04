import type { APIEvent } from "@solidjs/start/server";
import { randomBytes } from "node:crypto";

import {
  getMemoryBackupQueue,
  type MemoryBackupQueue,
} from "../backup";
import {
  loadRuntimeTraumaConfig,
  type ResolvedTraumaConfig,
} from "../config";
import { initializeDatabase } from "../db";
import { jsonResponse } from "../http/json";
import {
  CodexAppServerClient,
  CodexAppServerError,
  type CodexAppServerEvent,
  type CodexConversationClient,
} from "../translation/codex-app-server";
import { activePsychiatristTurns } from "./active-turns";
import { buildPsychiatristMemoryContext, PsychiatristContextError } from "./context";
import { buildPsychiatristPrompt } from "./prompt";
import { sanitizePsychiatristSourceCitations } from "./source-citations";
import { appendPsychiatristStreamEvent } from "./stream-store";
import {
  appendRegeneratedAssistantResponse,
  loadPsychiatristPairRegeneration,
  markPsychiatristThreadStale,
  markPsychiatristTurnCompleted,
  markPsychiatristRegenerateFailed,
  PsychiatristThreadStoreError,
  recordPsychiatristTurnStarted,
} from "./thread-store";
import type {
  PsychiatristThreadPair,
  PsychiatristWebSourcePolicy,
} from "./types";

type RegeneratePayload =
  | {
      ok: true;
      webSourcePermission: "deny" | "allow_for_this_turn";
    }
  | { ok: false; message: string };

type ResolveRegenerateActiveContentHash = (input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  loaded: Awaited<ReturnType<typeof loadPsychiatristPairRegeneration>>;
}) => Promise<string>;

export function createRegeneratePsychiatristResponseHandler(input: {
  backupQueue?: MemoryBackupQueue;
  client?: CodexConversationClient;
  config?: ResolvedTraumaConfig;
  generateId?: () => string;
  loadPair?: typeof loadPsychiatristPairRegeneration;
  resolveActiveContentHash?: ResolveRegenerateActiveContentHash;
} = {}) {
  return async function regeneratePsychiatristResponse(event: APIEvent): Promise<Response> {
    return handleRegeneratePsychiatristResponseRequest(event, input);
  };
}

export async function handleRegeneratePsychiatristResponseRequest(
  event: APIEvent,
  input: {
    backupQueue?: MemoryBackupQueue;
    client?: CodexConversationClient;
    config?: ResolvedTraumaConfig;
    generateId?: () => string;
    loadPair?: typeof loadPsychiatristPairRegeneration;
    resolveActiveContentHash?: ResolveRegenerateActiveContentHash;
  } = {},
): Promise<Response> {
  const pairId = event.params.pairId?.trim();
  if (pairId === undefined || pairId === "") {
    return safeErrorResponse("invalid_request", "pairId must be a non-empty string.", 400);
  }
  const payload = await parseRegeneratePayload(event.request);
  if (!payload.ok) {
    return safeErrorResponse("invalid_request", payload.message, 400);
  }

  const config = input.config ?? loadRuntimeTraumaConfig();
  const loadPair = input.loadPair ?? loadPsychiatristPairRegeneration;
  const loaded = await loadPair({ config, pairId }).catch((error: unknown) => {
    if (error instanceof PsychiatristThreadStoreError) {
      return error;
    }
    throw error;
  });
  if (loaded instanceof PsychiatristThreadStoreError) {
    return safeErrorResponse("pair_not_found", "Psychiatrist pair was not found.", 404);
  }
  if (loaded.pair.status !== "completed" || loaded.pair.assistant === undefined) {
    return safeErrorResponse(
      "regenerate_unavailable",
      "Only completed Psychiatrist responses can be regenerated.",
      409,
    );
  }
  if (loaded.manifest.status === "stale") {
    return safeErrorResponse(
      "thread_stale",
      "Psychiatrist thread is stale. Refresh the thread and retry.",
      409,
    );
  }
  if (!activePsychiatristTurns.reserveThread(loaded.manifest.threadId)) {
    return safeErrorResponse(
      "turn_conflict",
      "A Psychiatrist turn is already running for this thread.",
      409,
    );
  }

  const turnId = input.generateId?.() ?? generateUuidV7Like();
  try {
    const resolveActiveContentHash = input.resolveActiveContentHash ??
      defaultResolveRegenerateActiveContentHash;
    const activeContentHash = await resolveActiveContentHash({ config, loaded });
    if (activeContentHash !== loaded.manifest.activeContentHash) {
      activePsychiatristTurns.releaseThread(loaded.manifest.threadId);
      await markPsychiatristThreadStale({ config, threadId: loaded.manifest.threadId });
      await appendPsychiatristStreamEvent({
        config,
        event: {
          data: { pair_id: pairId, status: "stale" },
          memoryId: loaded.manifest.memoryId,
          threadId: loaded.manifest.threadId,
          turnId,
          type: "psychiatrist.thread.stale",
        },
      });
      return safeErrorResponse(
        "thread_stale",
        "Psychiatrist thread is stale. Refresh the thread and retry.",
        409,
      );
    }
  } catch (error) {
    activePsychiatristTurns.releaseThread(loaded.manifest.threadId);
    return formatRegeneratePreflightError(error);
  }
  const webSourcePolicy: PsychiatristWebSourcePolicy =
    payload.webSourcePermission === "allow_for_this_turn"
      ? { allowed: true, reason: "user_approved_for_turn" }
      : { allowed: false, reason: "default_denied" };

  try {
    await recordPsychiatristTurnStarted({
      config,
      pairId,
      regenerateFromTurnId: loaded.pair.turnId,
      threadId: loaded.manifest.threadId,
      turnId,
    });
    await appendPsychiatristStreamEvent({
      config,
      event: {
        data: { pair_id: pairId, status: "running" },
        memoryId: loaded.manifest.memoryId,
        threadId: loaded.manifest.threadId,
        turnId,
        type: "psychiatrist.regenerate.started",
      },
    });

    const ownsClient = input.client === undefined;
    const client = input.client ?? new CodexAppServerClient();
    activePsychiatristTurns.register({
      client,
      ...(loaded.manifest.codexThreadId === undefined
        ? {}
        : { codexThreadId: loaded.manifest.codexThreadId }),
      memoryId: loaded.manifest.memoryId,
      pairId,
      threadId: loaded.manifest.threadId,
      turnId,
    });
    void runRegenerateTurn({
      backupQueue: input.backupQueue ?? getMemoryBackupQueue(config),
      client,
      config,
      loaded,
      ownsClient,
      pairId,
      turnId,
      webSourcePolicy,
    });
  } catch (error) {
    activePsychiatristTurns.releaseThread(loaded.manifest.threadId);
    return safeErrorResponse(
      error instanceof CodexAppServerError ? error.code : "unknown",
      "Psychiatrist regenerate request failed.",
      500,
    );
  }

  const eventUrl = `/api/psychiatrist-turns/${turnId}/events`;
  return jsonResponse({
    event_url: eventUrl,
    pair_id: pairId,
    replay_url: eventUrl,
    status: "started",
    thread_id: loaded.manifest.threadId,
    turn_id: turnId,
  }, { status: 202 });
}

async function runRegenerateTurn(input: {
  backupQueue: MemoryBackupQueue;
  client: CodexConversationClient;
  config: ResolvedTraumaConfig;
  loaded: Awaited<ReturnType<typeof loadPsychiatristPairRegeneration>>;
  ownsClient: boolean;
  pairId: string;
  turnId: string;
  webSourcePolicy: PsychiatristWebSourcePolicy;
}): Promise<void> {
  const pair = input.loaded.pair;
  let assistantResponsePersisted = false;
  try {
    let eventWriteChain = Promise.resolve();
    const result = await input.client.runConversationTurn({
      cwdPurpose: "psychiatrist",
      input: buildPsychiatristPrompt({
        context: {
          categories: input.loaded.contextSnapshot.categories,
          contentHash: input.loaded.contextSnapshot.contentHash,
          ...(input.loaded.contextSnapshot.langCode === undefined
            ? {}
            : { langCode: input.loaded.contextSnapshot.langCode }),
          memoryId: input.loaded.contextSnapshot.memoryId,
          relativePath: input.loaded.contextSnapshot.relativePath,
          sections: input.loaded.contextSnapshot.sections,
          sourceHash: input.loaded.manifest.sourceHash,
          sourceUrl: input.loaded.contextSnapshot.sourceUrl,
          tags: input.loaded.contextSnapshot.tags,
          title: input.loaded.contextSnapshot.title,
          variantKind: input.loaded.contextSnapshot.variantKind,
        },
        contextSnapshotId: input.loaded.contextSnapshot.contextSnapshotId,
        pairs: withoutCurrentAssistant(input.loaded.thread.pairs, input.pairId),
        regenerate: {
          originalPairId: input.pairId,
          originalTurnId: pair.turnId,
          reason: "user_requested_regenerate",
        },
        threadId: input.loaded.manifest.threadId,
        userMessage: input.loaded.prompt,
        webSourcePolicy: input.webSourcePolicy,
      }),
      networkAccess: input.webSourcePolicy.allowed
        ? "user_approved_web_sources"
        : "disabled",
      onEvent: (codexEvent) => {
        if (codexEvent.type === "thread.started") {
          activePsychiatristTurns.updateCodexIds({
            codexThreadId: codexEvent.threadId,
            turnId: input.turnId,
          });
        }
        if (codexEvent.type === "turn.started") {
          activePsychiatristTurns.updateCodexIds({
            codexTurnId: codexEvent.turnId,
            turnId: input.turnId,
          });
        }
        eventWriteChain = eventWriteChain.then(() =>
          persistCodexEvent({
            config: input.config,
            event: codexEvent,
            memoryId: input.loaded.manifest.memoryId,
            threadId: input.loaded.manifest.threadId,
            turnId: input.turnId,
          }),
        );
      },
      threadId: input.loaded.manifest.codexThreadId,
    });
    await eventWriteChain;
    if (!input.webSourcePolicy.allowed && result.webSourceRequired === true) {
      const safeError = {
        action: "retry" as const,
        code: "network_permission_required",
        message: "Allow web-source access to answer this request.",
      };
      await markPsychiatristRegenerateFailed({
        config: input.config,
        error: safeError,
        pairId: input.pairId,
        threadId: input.loaded.manifest.threadId,
        turnId: input.turnId,
      });
      await appendPsychiatristStreamEvent({
        config: input.config,
        event: {
          data: {
            code: safeError.code,
            message: safeError.message,
            pair_id: input.pairId,
            retry_action: "regenerate",
            user_prompt: input.loaded.prompt,
          },
          memoryId: input.loaded.manifest.memoryId,
          threadId: input.loaded.manifest.threadId,
          turnId: input.turnId,
          type: "psychiatrist.network.permission_required",
        },
      });
      return;
    }
    const sourceCitations = sanitizePsychiatristSourceCitations(result.sourceCitations);
    await appendRegeneratedAssistantResponse({
      assistantResponse: result.outputText,
      citations: sourceCitations,
      config: input.config,
      pairId: input.pairId,
      threadId: input.loaded.manifest.threadId,
      turnId: input.turnId,
      webSourcePolicy: input.webSourcePolicy,
    });
    assistantResponsePersisted = true;
    await markPsychiatristTurnCompleted({
      codexThreadId: result.threadId,
      codexTurnId: result.turnId,
      config: input.config,
      pairId: input.pairId,
      regenerateFromTurnId: pair.turnId,
      threadId: input.loaded.manifest.threadId,
      turnId: input.turnId,
    });
    const backupWarning = await input.backupQueue.enqueue({
      contentPaths: [
        input.loaded.paths.threadMarkdownRelativePath,
        input.loaded.paths.pairResponseRelativePath,
        input.loaded.paths.pairRevisionLogRelativePath,
      ],
      memoryId: input.loaded.manifest.memoryId,
      reason: "psychiatrist_response_regenerate",
    }).then(() => undefined).catch(() => ({
      code: "backup_enqueue_failed",
      message: "Psychiatrist answer was saved, but backup enqueue failed.",
    }));
    await appendPsychiatristStreamEvent({
      config: input.config,
      event: {
        data: {
          ...(backupWarning === undefined ? {} : { warning: backupWarning }),
          pair_id: input.pairId,
          source_citations: sourceCitations.map((citation) => ({
            source_id: citation.sourceId,
            title: citation.title,
            url: citation.url,
          })),
        },
        memoryId: input.loaded.manifest.memoryId,
        threadId: input.loaded.manifest.threadId,
        turnId: input.turnId,
        type: "psychiatrist.regenerate.completed",
      },
    });
  } catch (error) {
    if (error instanceof CodexAppServerError && error.code === "turn_interrupted") {
      return;
    }
    if (assistantResponsePersisted) {
      await appendPsychiatristStreamEvent({
        config: input.config,
        event: {
          data: {
            pair_id: input.pairId,
            warning: {
              code: "post_save_finalization_failed",
              message: "Psychiatrist answer was saved, but completion metadata could not be finalized.",
            },
          },
          memoryId: input.loaded.manifest.memoryId,
          threadId: input.loaded.manifest.threadId,
          turnId: input.turnId,
          type: "psychiatrist.regenerate.completed",
        },
      }).catch(() => undefined);
      return;
    }
    const safeError = toSafeCodexError(error, "Psychiatrist regenerate failed.");
    await markPsychiatristRegenerateFailed({
      config: input.config,
      error: safeError,
      pairId: input.pairId,
      threadId: input.loaded.manifest.threadId,
      turnId: input.turnId,
    });
    await appendPsychiatristStreamEvent({
      config: input.config,
      event: {
        data: { code: safeError.code, message: safeError.message },
        memoryId: input.loaded.manifest.memoryId,
        threadId: input.loaded.manifest.threadId,
        turnId: input.turnId,
        type: "psychiatrist.answer.failed",
      },
    });
  } finally {
    activePsychiatristTurns.unregister(input.turnId);
    if (input.ownsClient) {
      await closeOwnedClient(input.client);
    }
  }
}

async function defaultResolveRegenerateActiveContentHash(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  loaded: Awaited<ReturnType<typeof loadPsychiatristPairRegeneration>>;
}): Promise<string> {
  if (!("backup" in input.config)) {
    return input.loaded.contextSnapshot.contentHash;
  }
  const connection = initializeDatabase(input.config as ResolvedTraumaConfig);
  try {
    const context = await buildPsychiatristMemoryContext({
      config: input.config,
      langCode: input.loaded.manifest.langCode,
      memoryId: input.loaded.manifest.memoryId,
      memoryRepository: connection.repositories.memories,
      translationRepository: connection.repositories.translations,
    });
    return context.contentHash;
  } finally {
    connection.close();
  }
}

async function closeOwnedClient(client: CodexConversationClient): Promise<void> {
  try {
    await client.close?.();
  } catch {
    // A close failure must not rewrite the persisted turn outcome.
  }
}

async function persistCodexEvent(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  event: CodexAppServerEvent;
  memoryId: string;
  threadId: string;
  turnId: string;
}): Promise<void> {
  if (input.event.type === "process") {
    await appendPsychiatristStreamEvent({
      config: input.config,
      event: {
        data: { text: input.event.message },
        memoryId: input.memoryId,
        threadId: input.threadId,
        turnId: input.turnId,
        type: "psychiatrist.process.delta",
      },
    });
  }
  if (input.event.type === "delta") {
    await appendPsychiatristStreamEvent({
      config: input.config,
      event: {
        data: { text: input.event.text },
        memoryId: input.memoryId,
        threadId: input.threadId,
        turnId: input.turnId,
        type: "psychiatrist.answer.delta",
      },
    });
  }
}

async function parseRegeneratePayload(request: Request): Promise<RegeneratePayload> {
  let payload: unknown;
  try {
    payload = JSON.parse(await request.text());
  } catch {
    return { ok: false, message: "request body must be JSON." };
  }
  if (!isRecord(payload)) {
    return { ok: false, message: "request body must be an object." };
  }
  const webSourcePermission =
    typeof payload.web_source_permission === "string"
      ? payload.web_source_permission
      : "deny";
  if (
    webSourcePermission !== "deny" &&
    webSourcePermission !== "allow_for_this_turn"
  ) {
    return {
      ok: false,
      message: "web_source_permission must be deny or allow_for_this_turn.",
    };
  }
  return { ok: true, webSourcePermission };
}

function withoutCurrentAssistant(
  pairs: PsychiatristThreadPair[],
  pairId: string,
): PsychiatristThreadPair[] {
  return pairs.map((pair) =>
    pair.pairId === pairId
      ? { ...pair, assistant: undefined, status: "pending" }
      : pair
  );
}

function safeErrorResponse(
  code: string,
  message: string,
  status: number,
): Response {
  return jsonResponse(
    {
      action: safeErrorAction(code),
      code,
      message,
      status: "error",
    },
    { status },
  );
}

function safeErrorAction(code: string): "allow_web_sources" | "open_reader" | "refresh_thread" | "retry" | "setup_codex_auth" {
  if (code === "auth_required") {
    return "setup_codex_auth";
  }
  if (code === "pair_not_found") {
    return "open_reader";
  }
  if (code === "thread_stale") {
    return "refresh_thread";
  }
  if (code === "network_permission_required") {
    return "allow_web_sources";
  }
  return "retry";
}

function formatRegeneratePreflightError(error: unknown): Response {
  if (error instanceof PsychiatristContextError) {
    return safeErrorResponse(
      error.code,
      error.code === "missing_memory"
        ? "Memory was not found."
        : "Psychiatrist context is unavailable for this memory.",
      error.code === "missing_memory" ? 404 : 409,
    );
  }
  return safeErrorResponse(
    error instanceof CodexAppServerError ? error.code : "unknown",
    "Psychiatrist regenerate request failed.",
    500,
  );
}

function toSafeCodexError(error: unknown, fallbackMessage: string): {
  action: "retry";
  code: string;
  message: string;
} {
  if (!(error instanceof CodexAppServerError)) {
    return {
      action: "retry",
      code: "unknown",
      message: fallbackMessage,
    };
  }
  return {
    action: "retry",
    code: error.code,
    message: safeCodexErrorMessage(error.code, fallbackMessage),
  };
}

function safeCodexErrorMessage(code: string, fallbackMessage: string): string {
  if (code === "auth_required") {
    return "Codex authentication is required before using Psychiatrist.";
  }
  if (code === "app_server_unavailable") {
    return "Codex app-server is unavailable.";
  }
  if (code === "timeout") {
    return "Codex app-server request timed out.";
  }
  if (code === "turn_interrupted") {
    return "Psychiatrist turn was interrupted.";
  }
  return fallbackMessage;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
