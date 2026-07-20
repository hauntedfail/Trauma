import type { APIEvent } from "@solidjs/start/server";
import { randomBytes } from "node:crypto";

import {
  getMemoryBackupQueue,
  type DurableMemoryBackupQueue,
  type EnqueueMemoryBackupInput,
} from "../backup";
import {
  loadRuntimeTraumaConfig,
  type ResolvedTraumaConfig,
} from "../config";
import { jsonResponse } from "../http/json";
import {
  CodexAppServerClient,
  CodexAppServerError,
  type CodexAppServerEvent,
  type CodexConversationClient,
} from "../translation/codex-app-server";
import {
  activePsychiatristTurns,
  type ActivePsychiatristTurnRegistry,
} from "./active-turns";
import { runDetachedPsychiatristTask } from "./detached-task";
import { createPsychiatristEventPersistenceQueue } from "./event-persistence";
import {
  assertPsychiatristFinalAnswerWithinLimit,
  measurePsychiatristCodexEventBytes,
  PSYCHIATRIST_TURN_LIMITS,
  PsychiatristEventLimitError,
  type PsychiatristTurnLimits,
} from "./limits";
import {
  buildPsychiatristPrompt,
  PSYCHIATRIST_PROMPT_POLICY_VERSION,
} from "./prompt";
import {
  matchesPsychiatristVariantScope,
  psychiatristTurnEventsUrl,
  isRecord,
  readPsychiatristJsonBody,
  readPsychiatristRequestScope,
  type PsychiatristRequestScope,
} from "./request";
import {
  isPsychiatristRuntimeIsolationReady,
  PSYCHIATRIST_RUNTIME_ISOLATION_ERROR,
} from "./runtime-isolation";
import { sanitizePsychiatristSourceCitations } from "./source-citations";
import { appendPsychiatristStreamEvent } from "./stream-store";
import {
  appendRegeneratedAssistantResponse,
  appendRetriedAssistantResponse,
  loadPsychiatristPairRegeneration,
  loadPsychiatristTurnSafeError,
  markPsychiatristThreadStale,
  markPsychiatristTurnCompleted,
  markPsychiatristTurnFailed,
  markPsychiatristRegenerateFailed,
  PsychiatristThreadStoreError,
  recordPsychiatristTurnStarted,
} from "./thread-store";
import type {
  PsychiatristThreadPair,
  PsychiatristWebSourcePolicy,
} from "./types";
import { borrowRuntimeProcessLeaseForResources } from "../runtime/process-lease";

type RegeneratePayload =
  | {
      ok: true;
      scope: PsychiatristRequestScope;
      webSourcePermission: "deny" | "allow_for_this_turn";
    }
  | { ok: false; message: string; status: number };

type RegenerateTurnMode = "answer_retry" | "regenerate";

export function createRegeneratePsychiatristResponseHandler(input: {
  activeTurns?: ActivePsychiatristTurnRegistry;
  appendRegeneratedAssistantResponse?: typeof appendRegeneratedAssistantResponse;
  appendRetriedAssistantResponse?: typeof appendRetriedAssistantResponse;
  appendStreamEvent?: typeof appendPsychiatristStreamEvent;
  backupQueue?: DurableMemoryBackupQueue;
  client?: CodexConversationClient;
  config?: ResolvedTraumaConfig;
  createClient?: () => CodexConversationClient;
  generateId?: () => string;
  limits?: PsychiatristTurnLimits;
  loadPair?: typeof loadPsychiatristPairRegeneration;
} = {}) {
  return async function regeneratePsychiatristResponse(event: APIEvent): Promise<Response> {
    return handleRegeneratePsychiatristResponseRequest(event, input);
  };
}

export async function handleRegeneratePsychiatristResponseRequest(
  event: APIEvent,
  input: {
    activeTurns?: ActivePsychiatristTurnRegistry;
    appendRegeneratedAssistantResponse?: typeof appendRegeneratedAssistantResponse;
    appendRetriedAssistantResponse?: typeof appendRetriedAssistantResponse;
    appendStreamEvent?: typeof appendPsychiatristStreamEvent;
    backupQueue?: DurableMemoryBackupQueue;
    client?: CodexConversationClient;
    config?: ResolvedTraumaConfig;
    createClient?: () => CodexConversationClient;
    generateId?: () => string;
    limits?: PsychiatristTurnLimits;
    loadPair?: typeof loadPsychiatristPairRegeneration;
  } = {},
): Promise<Response> {
  const memoryId = event.params.memoryId?.trim();
  if (memoryId === undefined || memoryId === "") {
    return safeErrorResponse("invalid_request", "memoryId must be a non-empty string.", 400);
  }
  const threadId = event.params.threadId?.trim();
  if (threadId === undefined || threadId === "") {
    return safeErrorResponse("invalid_request", "threadId must be a non-empty string.", 400);
  }
  const pairId = event.params.pairId?.trim();
  if (pairId === undefined || pairId === "") {
    return safeErrorResponse("invalid_request", "pairId must be a non-empty string.", 400);
  }
  const payload = await parseRegeneratePayload(event.request);
  if (!payload.ok) {
    return safeErrorResponse("invalid_request", payload.message, payload.status);
  }
  if (
    !isPsychiatristRuntimeIsolationReady({
      hasInjectedClient:
        input.client !== undefined || input.createClient !== undefined,
    })
  ) {
    return safeErrorResponse(
      PSYCHIATRIST_RUNTIME_ISOLATION_ERROR.code,
      PSYCHIATRIST_RUNTIME_ISOLATION_ERROR.message,
      503,
    );
  }

  const config = input.config ?? loadRuntimeTraumaConfig();
  const activeTurns = input.activeTurns ?? activePsychiatristTurns;
  const loadPair = input.loadPair ?? loadPsychiatristPairRegeneration;
  if (payload.scope.memoryId !== memoryId || payload.scope.threadId !== threadId) {
    return safeErrorResponse(
      "regenerate_unavailable",
      "Only completed Psychiatrist responses can be regenerated.",
      409,
    );
  }
  const loaded = await loadPair({ config, memoryId, pairId, threadId }).catch((error: unknown) => {
    if (error instanceof PsychiatristThreadStoreError) {
      return error;
    }
    throw error;
  });
  if (loaded instanceof PsychiatristThreadStoreError) {
    return safeErrorResponse(
      "regenerate_unavailable",
      "Only completed Psychiatrist responses can be regenerated.",
      409,
    );
  }
  if (!matchesManifestScope(payload.scope, loaded.manifest)) {
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
  if (loaded.manifest.policyVersion !== PSYCHIATRIST_PROMPT_POLICY_VERSION) {
    await markPsychiatristThreadStale({
      config,
      memoryId: loaded.manifest.memoryId,
      threadId: loaded.manifest.threadId,
    });
    return safeErrorResponse(
      "thread_stale",
      "Psychiatrist thread is stale. Refresh the thread and retry.",
      409,
    );
  }
  let turnMode: RegenerateTurnMode | undefined;
  try {
    turnMode = await resolveRegenerateTurnMode({
      config,
      loaded,
      webSourcePermission: payload.webSourcePermission,
    });
  } catch (error) {
    if (error instanceof PsychiatristThreadStoreError) {
      return safeErrorResponse(
        "regenerate_unavailable",
        "Only completed Psychiatrist responses can be regenerated.",
        409,
      );
    }
    throw error;
  }
  if (turnMode === undefined) {
    return safeErrorResponse(
      "regenerate_unavailable",
      "Only completed Psychiatrist responses can be regenerated.",
      409,
    );
  }
  const reservation = activeTurns.tryReserveThread(loaded.manifest.threadId);
  if (reservation === "thread_conflict") {
    return safeErrorResponse(
      "turn_conflict",
      "A Psychiatrist turn is already running for this thread.",
      409,
    );
  }
  if (reservation === "capacity_exceeded") {
    return safeErrorResponse(
      "turn_capacity_exceeded",
      "Psychiatrist is at capacity. Retry shortly.",
      429,
      { "retry-after": "1" },
    );
  }

  const turnId = input.generateId?.() ?? generateUuidV7Like();
  const webSourcePolicy: PsychiatristWebSourcePolicy =
    payload.webSourcePermission === "allow_for_this_turn"
      ? { allowed: true, reason: "user_approved_for_turn" }
      : { allowed: false, reason: "default_denied" };

  let runtimeBorrow;
  try {
    runtimeBorrow = borrowRuntimeProcessLeaseForResources([
      { resourceLabel: "storePath", resourcePath: config.storePath },
    ]);
  } catch {
    activeTurns.releaseThread(loaded.manifest.threadId);
    return safeErrorResponse(
      "storage_unavailable",
      "TRAUMA storage is unavailable. Restart TRAUMA and retry.",
      503,
    );
  }

  let runtimeBorrowTransferred = false;
  try {
    await recordPsychiatristTurnStarted({
      config,
      pairId,
      ...(turnMode === "regenerate" ? { regenerateFromTurnId: loaded.pair.turnId } : {}),
      threadId: loaded.manifest.threadId,
      turnId,
    });
    await (input.appendStreamEvent ?? appendPsychiatristStreamEvent)({
      config,
      event: {
        data: { pair_id: pairId, status: "running" },
        memoryId: loaded.manifest.memoryId,
        threadId: loaded.manifest.threadId,
        turnId,
        type: turnMode === "regenerate"
          ? "psychiatrist.regenerate.started"
          : "psychiatrist.turn.started",
      },
    });

    const ownsClient = input.client === undefined;
    const client = input.client ?? input.createClient?.() ?? new CodexAppServerClient();
    activeTurns.register({
      client,
      ...(loaded.contextSnapshot.langCode === undefined ? {} : { langCode: loaded.contextSnapshot.langCode }),
      memoryId: loaded.manifest.memoryId,
      pairId,
      threadId: loaded.manifest.threadId,
      turnId,
      variantKind: loaded.contextSnapshot.variantKind,
    });
    runDetachedPsychiatristTask(async () => {
      try {
        await runRegenerateTurn({
          appendRegeneratedAssistantResponse: input.appendRegeneratedAssistantResponse ??
            appendRegeneratedAssistantResponse,
          activeTurns,
          appendRetriedAssistantResponse: input.appendRetriedAssistantResponse ??
            appendRetriedAssistantResponse,
          appendStreamEvent: input.appendStreamEvent ?? appendPsychiatristStreamEvent,
          backupQueue: input.backupQueue ?? getMemoryBackupQueue(config),
          client,
          config,
          loaded,
          ownsClient,
          pairId,
          turnMode,
          turnId,
          webSourcePolicy,
          limits: input.limits ?? PSYCHIATRIST_TURN_LIMITS,
        });
      } finally {
        runtimeBorrow?.release();
      }
    });
    runtimeBorrowTransferred = true;
  } catch (error) {
    activeTurns.unregister(turnId);
    activeTurns.releaseThread(loaded.manifest.threadId);
    return safeErrorResponse(
      error instanceof CodexAppServerError ? error.code : "unknown",
      "Psychiatrist regenerate request failed.",
      500,
    );
  } finally {
    if (!runtimeBorrowTransferred) {
      runtimeBorrow?.release();
    }
  }

  const eventUrl = psychiatristTurnEventsUrl({
    ...(loaded.manifest.langCode === undefined ? {} : { langCode: loaded.manifest.langCode }),
    memoryId: loaded.manifest.memoryId,
    threadId: loaded.manifest.threadId,
    turnId,
    variantKind: loaded.manifest.variantKind,
  });
  return jsonResponse({
    event_url: eventUrl,
    pair_id: pairId,
    replay_url: eventUrl,
    status: "started",
    thread_id: loaded.manifest.threadId,
    turn_id: turnId,
  }, { status: 202 });
}

async function resolveRegenerateTurnMode(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  loaded: Awaited<ReturnType<typeof loadPsychiatristPairRegeneration>>;
  webSourcePermission: "deny" | "allow_for_this_turn";
}): Promise<RegenerateTurnMode | undefined> {
  if (input.loaded.pair.status === "completed" && input.loaded.pair.assistant !== undefined) {
    return "regenerate";
  }
  if (
    input.loaded.pair.status !== "failed" ||
    input.loaded.pair.assistant !== undefined ||
    input.webSourcePermission !== "allow_for_this_turn"
  ) {
    return undefined;
  }
  const safeError = await loadPsychiatristTurnSafeError({
    config: input.config,
    memoryId: input.loaded.manifest.memoryId,
    threadId: input.loaded.manifest.threadId,
    turnId: input.loaded.pair.turnId,
  });
  return safeError?.code === "network_permission_required" ? "answer_retry" : undefined;
}

async function runRegenerateTurn(input: {
  activeTurns: ActivePsychiatristTurnRegistry;
  appendRegeneratedAssistantResponse: typeof appendRegeneratedAssistantResponse;
  appendRetriedAssistantResponse: typeof appendRetriedAssistantResponse;
  appendStreamEvent: typeof appendPsychiatristStreamEvent;
  backupQueue: DurableMemoryBackupQueue;
  client: CodexConversationClient;
  config: ResolvedTraumaConfig;
  loaded: Awaited<ReturnType<typeof loadPsychiatristPairRegeneration>>;
  limits: PsychiatristTurnLimits;
  ownsClient: boolean;
  pairId: string;
  turnMode: RegenerateTurnMode;
  turnId: string;
  webSourcePolicy: PsychiatristWebSourcePolicy;
}): Promise<void> {
  const pair = input.loaded.pair;
  const isAnswerRetry = input.turnMode === "answer_retry";
  let assistantResponsePersisted = false;
  let completedAnswerText: string | undefined;
  const eventWrites = createPsychiatristEventPersistenceQueue(
    input.limits.eventPersistence,
  );
  try {
    const runOutcome = await Promise.resolve().then(() => input.client.runConversationTurn({
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
        pairs: isAnswerRetry
          ? beforeCurrentPair(input.loaded.thread.pairs, input.pairId)
          : withoutCurrentAssistant(input.loaded.thread.pairs, input.pairId),
        ...(isAnswerRetry
          ? {}
          : {
            regenerate: {
              originalPairId: input.pairId,
              originalTurnId: pair.turnId,
              reason: "user_requested_regenerate" as const,
            },
          }),
        threadId: input.loaded.manifest.threadId,
        userMessage: input.loaded.prompt,
        webSourcePolicy: input.webSourcePolicy,
      }),
      networkAccess: input.webSourcePolicy.allowed
        ? "user_approved_web_sources"
        : "disabled",
      onEvent: (codexEvent) => {
        const accepted = eventWrites.enqueue(() =>
          persistCodexEvent({
            appendStreamEvent: input.appendStreamEvent,
            config: input.config,
            event: codexEvent,
            memoryId: input.loaded.manifest.memoryId,
            threadId: input.loaded.manifest.threadId,
            turnId: input.turnId,
          }),
          measurePsychiatristCodexEventBytes(codexEvent),
        );
        if (!accepted) {
          return false;
        }
        if (codexEvent.type === "thread.started") {
          input.activeTurns.updateCodexIds({
            codexThreadId: codexEvent.threadId,
            turnId: input.turnId,
          });
        }
        if (codexEvent.type === "turn.started") {
          input.activeTurns.updateCodexIds({
            codexTurnId: codexEvent.turnId,
            turnId: input.turnId,
          });
        }
        return true;
      },
    })).then(
      (result) => ({ result, status: "completed" as const }),
      (error: unknown) => ({ error, status: "failed" as const }),
    );
    const persistenceOutcome = await eventWrites.drain().then(
      () => ({ status: "completed" as const }),
      (error: unknown) => ({ error, status: "failed" as const }),
    );
    if (runOutcome.status === "failed") {
      throw runOutcome.error;
    }
    if (persistenceOutcome.status === "failed") {
      throw persistenceOutcome.error;
    }
    const result = runOutcome.result;
    assertPsychiatristFinalAnswerWithinLimit(
      result.outputText,
      input.limits.maxFinalAnswerBytes,
    );
    if (!input.webSourcePolicy.allowed && result.webSourceRequired === true) {
      const safeError = {
        action: "retry" as const,
        code: "network_permission_required",
        message: "Allow web-source access to answer this request.",
      };
      if (isAnswerRetry) {
        const terminalStatus = await markPsychiatristTurnFailed({
          codexThreadId: result.threadId,
          codexTurnId: result.turnId,
          config: input.config,
          error: safeError,
          pairId: input.pairId,
          threadId: input.loaded.manifest.threadId,
          turnId: input.turnId,
        });
        if (terminalStatus !== "failed") {
          return;
        }
      } else {
        const terminalStatus = await markPsychiatristRegenerateFailed({
          config: input.config,
          error: safeError,
          pairId: input.pairId,
          threadId: input.loaded.manifest.threadId,
          turnId: input.turnId,
        });
        if (terminalStatus !== "failed") {
          return;
        }
      }
      await input.appendStreamEvent({
        config: input.config,
        event: {
          data: {
            code: safeError.code,
            message: safeError.message,
            pair_id: input.pairId,
            retry_action: "allow_web_sources",
            retry_mode: isAnswerRetry ? "first_answer" : "regenerate",
            retry_turn_id: input.turnId,
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
    completedAnswerText = result.outputText;
    const backupJob = regeneratedAnswerBackupInput(input);
    await input.backupQueue.persistIntent(backupJob);
    const appendAssistant = isAnswerRetry
      ? input.appendRetriedAssistantResponse
      : input.appendRegeneratedAssistantResponse;
    const appendResult = await appendAssistant({
      assistantResponse: result.outputText,
      citations: sourceCitations,
      config: input.config,
      pairId: input.pairId,
      threadId: input.loaded.manifest.threadId,
      turnId: input.turnId,
      webSourcePolicy: input.webSourcePolicy,
    });
    assistantResponsePersisted = true;
    const postSaveWarning = appendResult.warning === "post_save_finalization_failed"
      ? {
        code: "post_save_finalization_failed",
        message: "Psychiatrist answer was saved, but THREAD.md could not be refreshed.",
      }
      : undefined;
    await markPsychiatristTurnCompleted({
      codexThreadId: result.threadId,
      codexTurnId: result.turnId,
      config: input.config,
      pairId: input.pairId,
      ...(isAnswerRetry ? {} : { regenerateFromTurnId: pair.turnId }),
      threadId: input.loaded.manifest.threadId,
      turnId: input.turnId,
    });
    const completedEventInput = {
      data: {
        ...(postSaveWarning === undefined ? {} : { warning: postSaveWarning }),
        pair_id: input.pairId,
        source_citations: sourceCitations.map((citation) => ({
          source_id: citation.sourceId,
          title: citation.title,
          url: citation.url,
        })),
        text: result.outputText,
      },
      memoryId: input.loaded.manifest.memoryId,
      threadId: input.loaded.manifest.threadId,
      turnId: input.turnId,
      type: isAnswerRetry
        ? "psychiatrist.answer.completed" as const
        : "psychiatrist.regenerate.completed" as const,
    };
    let terminalFinalizerFailed = false;
    const backupWarning = await input.backupQueue.enqueue(backupJob, async () => {
      try {
        await input.appendStreamEvent({
          config: input.config,
          event: completedEventInput,
        });
      } catch (error) {
        terminalFinalizerFailed = true;
        throw error;
      }
    }).then(() => undefined).catch((error) => {
      if (terminalFinalizerFailed) {
        throw error;
      }
      return {
        code: "backup_enqueue_failed",
        message: "Psychiatrist answer was saved, but backup enqueue failed.",
      } as const;
    });
    if (backupWarning !== undefined) {
      await input.appendStreamEvent({
        config: input.config,
        event: {
          ...completedEventInput,
          data: {
            ...completedEventInput.data,
            warning: postSaveWarning ?? backupWarning,
          },
        },
      });
    }
  } catch (error) {
    if (error instanceof CodexAppServerError && error.code === "turn_interrupted") {
      return;
    }
    if (error instanceof PsychiatristThreadStoreError && error.code === "turn_canceled") {
      return;
    }
    if (assistantResponsePersisted) {
      await input.appendStreamEvent({
        config: input.config,
        event: {
          data: {
            pair_id: input.pairId,
            ...(completedAnswerText === undefined ? {} : { text: completedAnswerText }),
            warning: {
              code: "post_save_finalization_failed",
              message: "Psychiatrist answer was saved, but completion metadata could not be finalized.",
            },
          },
          memoryId: input.loaded.manifest.memoryId,
          threadId: input.loaded.manifest.threadId,
          turnId: input.turnId,
          type: isAnswerRetry
            ? "psychiatrist.answer.completed"
            : "psychiatrist.regenerate.completed",
        },
      }).catch(() => undefined);
      return;
    }
    const active = input.activeTurns.getByTurnId(input.turnId);
    const safeError = toSafeCodexError(
      error,
      isAnswerRetry ? "Psychiatrist answer failed." : "Psychiatrist regenerate failed.",
    );
    if (isAnswerRetry) {
      const terminalStatus = await markPsychiatristTurnFailed({
        codexThreadId: active?.codexThreadId,
        codexTurnId: active?.codexTurnId,
        config: input.config,
        error: safeError,
        pairId: input.pairId,
        threadId: input.loaded.manifest.threadId,
        turnId: input.turnId,
      });
      if (terminalStatus !== "failed") {
        return;
      }
    } else {
      const terminalStatus = await markPsychiatristRegenerateFailed({
        config: input.config,
        error: safeError,
        pairId: input.pairId,
        threadId: input.loaded.manifest.threadId,
        turnId: input.turnId,
      });
      if (terminalStatus !== "failed") {
        return;
      }
    }
    await input.appendStreamEvent({
      config: input.config,
      event: {
        data: {
          code: safeError.code,
          message: safeError.message,
          pair_id: input.pairId,
          ...(isAnswerRetry ? {} : { retry_mode: "regenerate" }),
        },
        memoryId: input.loaded.manifest.memoryId,
        threadId: input.loaded.manifest.threadId,
        turnId: input.turnId,
        type: "psychiatrist.answer.failed",
      },
    });
  } finally {
    await eventWrites.drain().catch(() => undefined);
    input.activeTurns.unregister(input.turnId);
    if (input.ownsClient) {
      await closeOwnedClient(input.client);
    }
  }
}

function regeneratedAnswerBackupInput(input: {
  loaded: Awaited<ReturnType<typeof loadPsychiatristPairRegeneration>>;
  turnId: string;
}): EnqueueMemoryBackupInput {
  return {
    contentPaths: [
      input.loaded.paths.threadManifestRelativePath,
      input.loaded.paths.threadMarkdownRelativePath,
      input.loaded.paths.pairPromptRelativePath,
      input.loaded.paths.pairContextRelativePath,
      input.loaded.paths.pairResponseRelativePath,
      input.loaded.paths.pairRevisionLogRelativePath,
      turnRecordRelativePath(
        input.loaded.manifest.memoryId,
        input.loaded.manifest.threadId,
        input.turnId,
      ),
      turnStreamRelativePath(
        input.loaded.manifest.memoryId,
        input.loaded.manifest.threadId,
        input.turnId,
      ),
    ],
    memoryId: input.loaded.manifest.memoryId,
    reason: "psychiatrist_response_regenerate",
  };
}

async function closeOwnedClient(client: CodexConversationClient): Promise<void> {
  try {
    await client.close?.();
  } catch {
    // A close failure must not rewrite the persisted turn outcome.
  }
}

function turnRecordRelativePath(memoryId: string, threadId: string, turnId: string): string {
  return `memories/${memoryId}/threads/${threadId}/turns/${turnId}.json`;
}

function turnStreamRelativePath(memoryId: string, threadId: string, turnId: string): string {
  return `memories/${memoryId}/threads/${threadId}/streams/${turnId}.jsonl`;
}

async function persistCodexEvent(input: {
  appendStreamEvent: typeof appendPsychiatristStreamEvent;
  config: Pick<ResolvedTraumaConfig, "storePath">;
  event: CodexAppServerEvent;
  memoryId: string;
  threadId: string;
  turnId: string;
}): Promise<void> {
  if (input.event.type === "process") {
    await input.appendStreamEvent({
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
    await input.appendStreamEvent({
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
  const body = await readPsychiatristJsonBody(request);
  if (!body.ok) {
    return { ok: false, message: body.message, status: body.status };
  }
  const payload = body.payload;
  if (!isRecord(payload)) {
    return { ok: false, message: "request body must be an object.", status: 400 };
  }
  const scope = readPsychiatristRequestScope(payload);
  if (!scope.ok) {
    return { ok: false, message: scope.message, status: 400 };
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
      status: 400,
    };
  }
  return { ok: true, scope: scope.scope, webSourcePermission };
}

function matchesManifestScope(
  scope: PsychiatristRequestScope,
  manifest: Awaited<ReturnType<typeof loadPsychiatristPairRegeneration>>["manifest"],
): boolean {
  return scope.memoryId === manifest.memoryId &&
    scope.threadId === manifest.threadId &&
    matchesPsychiatristVariantScope(scope, manifest);
}

function beforeCurrentPair(
  pairs: PsychiatristThreadPair[],
  pairId: string,
): PsychiatristThreadPair[] {
  const targetIndex = pairs.findIndex((pair) => pair.pairId === pairId);
  return targetIndex === -1
    ? pairs.filter((pair) => pair.pairId !== pairId)
    : pairs.slice(0, targetIndex);
}

function withoutCurrentAssistant(
  pairs: PsychiatristThreadPair[],
  pairId: string,
): PsychiatristThreadPair[] {
  const targetIndex = pairs.findIndex((pair) => pair.pairId === pairId);
  const historyPairs = targetIndex === -1 ? pairs : pairs.slice(0, targetIndex + 1);
  return historyPairs.map((pair) =>
    pair.pairId === pairId
      ? { ...pair, assistant: undefined, status: "pending" }
      : pair
  );
}

function safeErrorResponse(
  code: string,
  message: string,
  status: number,
  headers?: HeadersInit,
): Response {
  return jsonResponse(
    {
      action: safeErrorAction(code),
      code,
      message,
      status: "error",
    },
    { status, headers },
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

function toSafeCodexError(error: unknown, fallbackMessage: string): {
  action: "retry";
  code: string;
  message: string;
} {
  if (error instanceof PsychiatristEventLimitError) {
    return {
      action: "retry",
      code: error.code,
      message: "Psychiatrist response exceeded the supported event limit.",
    };
  }
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
  if (code === "event_limit_exceeded") {
    return "Psychiatrist response exceeded the supported event limit.";
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
