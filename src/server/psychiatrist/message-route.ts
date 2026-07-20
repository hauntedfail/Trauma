import type { APIEvent } from "@solidjs/start/server";
import { randomBytes } from "node:crypto";

import {
  createNoopMemoryBackupQueue,
  getMemoryBackupQueue,
  type DurableMemoryBackupQueue,
  type EnqueueMemoryBackupInput,
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
import { createSha256ContentHash } from "../translation/hash";
import { buildPsychiatristMemoryContext, PsychiatristContextError } from "./context";
import {
  buildPsychiatristPrompt,
  PSYCHIATRIST_PROMPT_POLICY_VERSION,
  selectPsychiatristPromptContext,
} from "./prompt";
import {
  isRecord,
  matchesPsychiatristVariantScope,
  psychiatristTurnEventsUrl,
  readOptionalPsychiatristLangCode,
  readOptionalPsychiatristVariantKind,
  readPsychiatristJsonBody,
} from "./request";
import {
  isPsychiatristRuntimeIsolationReady,
  PSYCHIATRIST_RUNTIME_ISOLATION_ERROR,
} from "./runtime-isolation";
import { sanitizePsychiatristSourceCitations } from "./source-citations";
import { appendPsychiatristStreamEvent } from "./stream-store";
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
  appendAssistantResponse as appendAssistantResponseToStore,
  appendPendingPair,
  loadPsychiatristThreadForMemory,
  markPsychiatristTurnCompleted,
  markPsychiatristTurnFailed,
  markPsychiatristThreadStale,
  PsychiatristThreadStoreError,
  recordPsychiatristTurnStarted,
} from "./thread-store";
import type {
  PsychiatristContextSnapshotManifest,
  PsychiatristMemoryContext,
  PsychiatristThreadManifest,
  PsychiatristThreadPair,
  PsychiatristWebSourcePolicy,
} from "./types";
import { borrowRuntimeProcessLeaseForResources } from "../runtime/process-lease";

export const PSYCHIATRIST_MAX_USER_MESSAGE_CHARS = 4_000;
type BuildContext = typeof buildPsychiatristMemoryContext;
type AppendAssistantResponse = typeof appendAssistantResponseToStore;
type MessagePayload =
  | {
      ok: true;
      langCode?: string;
      message: string;
      variantKind?: "source" | "translation";
      webSourcePermission: "deny" | "allow_for_this_turn";
    }
  | { ok: false; message: string; status: number };

type ResolveActiveContentHash = (input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  context: PsychiatristMemoryContext;
  manifest: PsychiatristThreadManifest;
}) => Promise<string>;

export function createSendPsychiatristMessageHandler(input: {
  activeTurns?: ActivePsychiatristTurnRegistry;
  appendAssistantResponse?: AppendAssistantResponse;
  appendStreamEvent?: typeof appendPsychiatristStreamEvent;
  backupQueue?: DurableMemoryBackupQueue;
  buildContext?: BuildContext;
  client?: CodexConversationClient;
  config?: Pick<ResolvedTraumaConfig, "storePath">;
  createClient?: () => CodexConversationClient;
  generateId?: () => string;
  loadThread?: typeof loadPsychiatristThreadForMemory;
  limits?: PsychiatristTurnLimits;
  now?: () => Date;
  resolveActiveContentHash?: ResolveActiveContentHash;
} = {}) {
  return async function sendPsychiatristMessage(event: APIEvent): Promise<Response> {
    return handleSendPsychiatristMessageRequest(event, input);
  };
}

export async function handleSendPsychiatristMessageRequest(
  event: APIEvent,
  input: {
    activeTurns?: ActivePsychiatristTurnRegistry;
    appendAssistantResponse?: AppendAssistantResponse;
    appendStreamEvent?: typeof appendPsychiatristStreamEvent;
    backupQueue?: DurableMemoryBackupQueue;
    buildContext?: BuildContext;
    client?: CodexConversationClient;
    config?: Pick<ResolvedTraumaConfig, "storePath">;
    createClient?: () => CodexConversationClient;
    generateId?: () => string;
    loadThread?: typeof loadPsychiatristThreadForMemory;
    limits?: PsychiatristTurnLimits;
    now?: () => Date;
    resolveActiveContentHash?: ResolveActiveContentHash;
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
  const payload = await parseMessagePayload(event.request);
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
  const loadThread = input.loadThread ?? loadPsychiatristThreadForMemory;
  let thread: { manifest: PsychiatristThreadManifest; pairs: PsychiatristThreadPair[] };
  try {
    thread = await loadThread({ config, memoryId, threadId });
  } catch (error) {
    return formatMessageError(error);
  }
  if (!matchesPsychiatristVariantScope(payload, thread.manifest)) {
    return safeErrorResponse(
      "thread_scope_mismatch",
      "Psychiatrist thread does not match the active reader variant.",
      409,
    );
  }
  if (thread.manifest.status === "stale") {
    return safeErrorResponse(
      "thread_stale",
      "Psychiatrist thread is stale. Refresh the thread and retry.",
      409,
    );
  }
  if (thread.manifest.policyVersion !== PSYCHIATRIST_PROMPT_POLICY_VERSION) {
    await markPsychiatristThreadStale({ config, memoryId, threadId });
    return safeErrorResponse(
      "thread_stale",
      "Psychiatrist thread is stale. Refresh the thread and retry.",
      409,
    );
  }
  const reservation = activeTurns.tryReserveThread(threadId);
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

  const pairId = input.generateId?.() ?? generateUuidV7Like();
  const turnId = input.generateId?.() ?? generateUuidV7Like();
  let context: PsychiatristMemoryContext;
  let activeContentHash: string;
  try {
    context = await resolveTurnContext({
      buildContext: input.buildContext,
      config,
      langCode: payload.langCode,
      manifest: thread.manifest,
    });
    const resolveActiveContentHash = input.resolveActiveContentHash ??
      defaultResolveActiveContentHash;
    activeContentHash = await resolveActiveContentHash({
      config,
      context,
      manifest: thread.manifest,
    });
  } catch (error) {
    activeTurns.releaseThread(threadId);
    return formatMessageError(error);
  }
  if (activeContentHash !== thread.manifest.activeContentHash) {
    activeTurns.releaseThread(threadId);
    await markPsychiatristThreadStale({ config, memoryId, threadId });
    await appendBestEffortStreamEvent(input.appendStreamEvent ?? appendPsychiatristStreamEvent, {
      config,
      event: {
        data: { status: "stale" },
        memoryId: thread.manifest.memoryId,
        threadId,
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
  const webSourcePolicy: PsychiatristWebSourcePolicy =
    payload.webSourcePermission === "allow_for_this_turn"
      ? { allowed: true, reason: "user_approved_for_turn" }
      : { allowed: false, reason: "default_denied" };
  const selectedContext = selectPsychiatristPromptContext({
    context,
    contextSnapshotId: pairId,
    pairs: thread.pairs,
    threadId,
    userMessage: payload.message,
    webSourcePolicy,
  });
  const contextSnapshot = createContextSnapshot({
    context: selectedContext,
    manifest: thread.manifest,
    pairId,
    prompt: payload.message,
  });

  let runtimeBorrow;
  try {
    runtimeBorrow = borrowRuntimeProcessLeaseForResources([
      { resourceLabel: "storePath", resourcePath: config.storePath },
    ]);
  } catch {
    activeTurns.releaseThread(threadId);
    return safeErrorResponse(
      "storage_unavailable",
      "TRAUMA storage is unavailable. Restart TRAUMA and retry.",
      503,
    );
  }

  let pendingPairPersisted = false;
  let runtimeBorrowTransferred = false;
  try {
    await appendPendingPair({
      config,
      contextSnapshot,
      pairId,
      prompt: payload.message,
      threadId,
      turnId,
    });
    pendingPairPersisted = true;
    await recordPsychiatristTurnStarted({
      config,
      pairId,
      threadId,
      turnId,
    });
    await appendBestEffortStreamEvent(input.appendStreamEvent ?? appendPsychiatristStreamEvent, {
      config,
      event: {
        data: {
          pair_id: pairId,
          status: "running",
          user_prompt: payload.message,
        },
        memoryId: thread.manifest.memoryId,
        threadId,
        turnId,
        type: "psychiatrist.turn.started",
      },
    });

    const ownsClient = input.client === undefined;
    const client = input.client ?? input.createClient?.() ?? new CodexAppServerClient();
    activeTurns.register({
      client,
      ...(context.langCode === undefined ? {} : { langCode: context.langCode }),
      memoryId: thread.manifest.memoryId,
      pairId,
      threadId,
      turnId,
      variantKind: context.variantKind,
    });
    runDetachedPsychiatristTask(async () => {
      try {
        await runPsychiatristTurn({
          appendAssistantResponse: input.appendAssistantResponse ?? appendAssistantResponseToStore,
          activeTurns,
          appendStreamEvent: input.appendStreamEvent ?? appendPsychiatristStreamEvent,
          backupQueue: input.backupQueue ?? resolveBackupQueue(config),
          client,
          config,
          context: selectedContext,
          pairId,
          payload,
          thread,
          threadId,
          turnId,
          webSourcePolicy,
          ownsClient,
          limits: input.limits ?? PSYCHIATRIST_TURN_LIMITS,
        });
      } finally {
        runtimeBorrow?.release();
      }
    });
    runtimeBorrowTransferred = true;
    return jsonResponse(toStartedResponse({
      manifest: thread.manifest,
      pairId,
      turnId,
    }), {
      status: 202,
    });
  } catch (error) {
    activeTurns.unregister(turnId);
    activeTurns.releaseThread(threadId);
    const safeError = toSafeCodexError(error, "Psychiatrist answer failed.");
    let terminalStatus: Awaited<ReturnType<typeof markPsychiatristTurnFailed>> | undefined;
    if (pendingPairPersisted) {
      terminalStatus = await markPsychiatristTurnFailed({
        config,
        error: safeError,
        pairId,
        threadId,
        turnId,
      }).catch(() => undefined);
    }
    if (!pendingPairPersisted || terminalStatus === "failed") {
      await appendBestEffortStreamEvent(input.appendStreamEvent ?? appendPsychiatristStreamEvent, {
        config,
        event: {
          data: {
            code: safeError.code,
            message: safeError.message,
            pair_id: pairId,
          },
          memoryId: thread.manifest.memoryId,
          threadId,
          turnId,
          type: "psychiatrist.answer.failed",
        },
      });
    }
    return formatMessageError(error);
  } finally {
    if (!runtimeBorrowTransferred) {
      runtimeBorrow?.release();
    }
  }
}

async function runPsychiatristTurn(input: {
  activeTurns: ActivePsychiatristTurnRegistry;
  appendAssistantResponse: AppendAssistantResponse;
  appendStreamEvent: typeof appendPsychiatristStreamEvent;
  backupQueue: DurableMemoryBackupQueue;
  client: CodexConversationClient;
  config: Pick<ResolvedTraumaConfig, "storePath">;
  context: PsychiatristMemoryContext;
  pairId: string;
  payload: { message: string };
  ownsClient: boolean;
  limits: PsychiatristTurnLimits;
  thread: { manifest: PsychiatristThreadManifest; pairs: PsychiatristThreadPair[] };
  threadId: string;
  turnId: string;
  webSourcePolicy: PsychiatristWebSourcePolicy;
}): Promise<void> {
  let assistantResponsePersisted = false;
  let completedAnswerText: string | undefined;
  const eventWrites = createPsychiatristEventPersistenceQueue(
    input.limits.eventPersistence,
  );
  try {
    const prompt = buildPsychiatristPrompt({
      context: input.context,
      contextSnapshotId: input.pairId,
      pairs: input.thread.pairs,
      threadId: input.threadId,
      userMessage: input.payload.message,
      webSourcePolicy: input.webSourcePolicy,
    });
    const runOutcome = await Promise.resolve().then(() => input.client.runConversationTurn({
      cwdPurpose: "psychiatrist",
      input: prompt,
      networkAccess: input.webSourcePolicy.allowed
        ? "user_approved_web_sources"
        : "disabled",
      onEvent: (codexEvent) => {
        const accepted = eventWrites.enqueue(() =>
          persistCodexEvent({
            appendStreamEvent: input.appendStreamEvent,
            config: input.config,
            event: codexEvent,
            memoryId: input.thread.manifest.memoryId,
            threadId: input.threadId,
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
      const terminalStatus = await markPsychiatristTurnFailed({
        codexThreadId: result.threadId,
        codexTurnId: result.turnId,
        config: input.config,
        error: safeError,
        pairId: input.pairId,
        threadId: input.threadId,
        turnId: input.turnId,
      });
      if (terminalStatus !== "failed") {
        return;
      }
      await input.appendStreamEvent({
        config: input.config,
        event: {
          data: {
            code: safeError.code,
            message: safeError.message,
            pair_id: input.pairId,
            retry_action: "allow_web_sources",
            retry_mode: "first_answer",
            retry_turn_id: input.turnId,
            user_prompt: input.payload.message,
          },
          memoryId: input.thread.manifest.memoryId,
          threadId: input.threadId,
          turnId: input.turnId,
          type: "psychiatrist.network.permission_required",
        },
      });
      return;
    }
    const sourceCitations = sanitizePsychiatristSourceCitations(result.sourceCitations);
    completedAnswerText = result.outputText;
    const backupJob = completedAnswerBackupInput(input);
    await input.backupQueue.persistIntent(backupJob);
    const appendResult = await input.appendAssistantResponse({
      assistantResponse: result.outputText,
      citations: sourceCitations,
      config: input.config,
      pairId: input.pairId,
      threadId: input.threadId,
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
      threadId: input.threadId,
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
      memoryId: input.thread.manifest.memoryId,
      threadId: input.threadId,
      turnId: input.turnId,
      type: "psychiatrist.answer.completed" as const,
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
    const active = input.activeTurns.getByTurnId(input.turnId);
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
          memoryId: input.thread.manifest.memoryId,
          threadId: input.threadId,
          turnId: input.turnId,
          type: "psychiatrist.answer.completed",
        },
      }).catch(() => undefined);
      return;
    }
    if (error instanceof CodexAppServerError && error.code === "turn_interrupted") {
      return;
    }
    if (error instanceof PsychiatristThreadStoreError && error.code === "turn_canceled") {
      return;
    }
    const safeError = toSafeCodexError(error, "Psychiatrist answer failed.");
    const terminalStatus = await markPsychiatristTurnFailed({
      codexThreadId: active?.codexThreadId,
      codexTurnId: active?.codexTurnId,
      config: input.config,
      error: safeError,
      pairId: input.pairId,
      threadId: input.threadId,
      turnId: input.turnId,
    });
    if (terminalStatus !== "failed") {
      return;
    }
    await input.appendStreamEvent({
      config: input.config,
      event: {
        data: { code: safeError.code, message: safeError.message },
        memoryId: input.thread.manifest.memoryId,
        threadId: input.threadId,
        turnId: input.turnId,
        type: "psychiatrist.answer.failed",
      },
    }).catch(() => undefined);
  } finally {
    await eventWrites.drain().catch(() => undefined);
    input.activeTurns.unregister(input.turnId);
    if (input.ownsClient) {
      await closeOwnedClient(input.client);
    }
  }
}

async function appendBestEffortStreamEvent<TData>(
  appendStreamEvent: typeof appendPsychiatristStreamEvent,
  input: Parameters<typeof appendPsychiatristStreamEvent<TData>>[0],
): Promise<void> {
  try {
    await appendStreamEvent(input);
  } catch {
    // API error responses must not expose or be replaced by stream telemetry failures.
  }
}

async function closeOwnedClient(client: CodexConversationClient): Promise<void> {
  try {
    await client.close?.();
  } catch {
    // A close failure must not rewrite the persisted turn outcome.
  }
}

function completedAnswerBackupInput(input: {
  pairId: string;
  thread: { manifest: PsychiatristThreadManifest };
  threadId: string;
  turnId: string;
}): EnqueueMemoryBackupInput {
  return {
    contentPaths: [
      `memories/${input.thread.manifest.memoryId}/threads/${input.threadId}/THREAD.json`,
      `memories/${input.thread.manifest.memoryId}/threads/${input.threadId}/THREAD.md`,
      `memories/${input.thread.manifest.memoryId}/threads/${input.threadId}/pairs/${input.pairId}/PROMPT.md`,
      `memories/${input.thread.manifest.memoryId}/threads/${input.threadId}/pairs/${input.pairId}/CONTEXT.json`,
      `memories/${input.thread.manifest.memoryId}/threads/${input.threadId}/pairs/${input.pairId}/RESPONSE.md`,
      `memories/${input.thread.manifest.memoryId}/threads/${input.threadId}/PAIRS.jsonl`,
      `memories/${input.thread.manifest.memoryId}/threads/${input.threadId}/turns/${input.turnId}.json`,
      `memories/${input.thread.manifest.memoryId}/threads/${input.threadId}/streams/${input.turnId}.jsonl`,
    ],
    memoryId: input.thread.manifest.memoryId,
    reason: "psychiatrist_thread_update",
  };
}

function resolveBackupQueue(
  config: Pick<ResolvedTraumaConfig, "storePath">,
): DurableMemoryBackupQueue {
  return "backup" in config
    ? getMemoryBackupQueue(config as ResolvedTraumaConfig)
    : createNoopMemoryBackupQueue();
}

async function parseMessagePayload(request: Request): Promise<MessagePayload> {
  const body = await readPsychiatristJsonBody(request);
  if (!body.ok) {
    return { ok: false, message: body.message, status: body.status };
  }
  const payload = body.payload;
  if (!isRecord(payload)) {
    return { ok: false, message: "request body must be an object.", status: 400 };
  }
  if (typeof payload.message !== "string" || payload.message.trim() === "") {
    return { ok: false, message: "message must be a non-empty string.", status: 400 };
  }
  const message = payload.message.trim();
  if (message.length > PSYCHIATRIST_MAX_USER_MESSAGE_CHARS) {
    return { ok: false, message: "message must be 4000 characters or fewer.", status: 400 };
  }
  const langCodeResult = readOptionalPsychiatristLangCode(payload);
  if (!langCodeResult.ok) {
    return { ok: false, message: langCodeResult.message, status: 400 };
  }
  const variantKindResult = readOptionalPsychiatristVariantKind(payload);
  if (!variantKindResult.ok) {
    return { ok: false, message: variantKindResult.message, status: 400 };
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
  return {
    ok: true,
    ...(langCodeResult.langCode === undefined ? {} : { langCode: langCodeResult.langCode }),
    message,
    ...(variantKindResult.variantKind === undefined
      ? {}
      : { variantKind: variantKindResult.variantKind }),
    webSourcePermission,
  };
}

function createContextSnapshot(input: {
  context: PsychiatristMemoryContext;
  manifest: PsychiatristThreadManifest;
  pairId: string;
  prompt: string;
}): PsychiatristContextSnapshotManifest {
  return {
    categories: input.context.categories,
    contentHash: input.context.contentHash,
    contextSnapshotId: input.pairId,
    ...(input.context.langCode === undefined
      ? {}
      : { langCode: input.context.langCode }),
    memoryId: input.manifest.memoryId,
    policyVersion: input.manifest.policyVersion,
    relativePath: input.context.relativePath,
    selectedSectionAnchors: input.context.sections.map((section) => section.anchor),
    selectedSectionHashes: input.context.sections.map((section) =>
      createSha256ContentHash(section.markdown)
    ),
    sections: input.context.sections,
    sourceUrl: input.context.sourceUrl,
    tags: input.context.tags,
    title: input.context.title,
    ...(input.context.translationOutputHash === undefined
      ? {}
      : { translationOutputHash: input.context.translationOutputHash }),
    userPrompt: input.prompt,
    variantKind: input.context.variantKind,
  };
}

async function resolveTurnContext(input: {
  buildContext?: BuildContext;
  config: Pick<ResolvedTraumaConfig, "storePath">;
  langCode?: string;
  manifest: PsychiatristThreadManifest;
}): Promise<PsychiatristMemoryContext> {
  if (input.buildContext !== undefined) {
    return await input.buildContext({
      config: input.config,
      langCode: input.langCode,
      memoryId: input.manifest.memoryId,
      memoryRepository: undefined as never,
      translationRepository: undefined as never,
    });
  }
  if (!("backup" in input.config)) {
    return fallbackManifestContext(input.manifest);
  }
  const connection = initializeDatabase(input.config as ResolvedTraumaConfig);
  try {
    return await buildPsychiatristMemoryContext({
      config: input.config,
      langCode: input.langCode,
      memoryId: input.manifest.memoryId,
      memoryRepository: connection.repositories.memories,
      translationRepository: connection.repositories.translations,
    });
  } finally {
    connection.close();
  }
}

function fallbackManifestContext(
  manifest: PsychiatristThreadManifest,
): PsychiatristMemoryContext {
  return {
    categories: [],
    contentHash: manifest.activeContentHash,
    ...(manifest.langCode === undefined ? {} : { langCode: manifest.langCode }),
    memoryId: manifest.memoryId,
    relativePath: "",
    sections: [],
    sourceHash: manifest.sourceHash,
    sourceUrl: "",
    tags: [],
    title: "",
    ...(manifest.translationOutputHash === undefined
      ? {}
      : { translationOutputHash: manifest.translationOutputHash }),
    variantKind: manifest.variantKind,
  };
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

function toStartedResponse(input: {
  manifest: PsychiatristThreadManifest;
  pairId: string;
  turnId: string;
}) {
  const eventUrl = psychiatristTurnEventsUrl({
    ...(input.manifest.langCode === undefined ? {} : { langCode: input.manifest.langCode }),
    memoryId: input.manifest.memoryId,
    threadId: input.manifest.threadId,
    turnId: input.turnId,
    variantKind: input.manifest.variantKind,
  });
  return {
    event_url: eventUrl,
    pair_id: input.pairId,
    replay_url: eventUrl,
    status: "started",
    thread_id: input.manifest.threadId,
    turn_id: input.turnId,
  };
}

function formatMessageError(error: unknown): Response {
  if (error instanceof PsychiatristThreadStoreError) {
    return safeErrorResponse(
      error.code === "thread_not_found" ? "thread_not_found" : "invalid_request",
      error.code === "thread_not_found"
        ? "Psychiatrist thread was not found."
        : "Psychiatrist message request is invalid.",
      error.code === "thread_not_found" ? 404 : 400,
    );
  }
  if (error instanceof PsychiatristContextError) {
    return safeErrorResponse(
      error.code,
      error.code === "missing_memory"
        ? "Memory was not found."
        : "Psychiatrist context is unavailable for this memory.",
      error.code === "missing_memory" ? 404 : 409,
    );
  }
  if (error instanceof CodexAppServerError) {
    const safeError = toSafeCodexError(error, "Psychiatrist message request failed.");
    return safeErrorResponse(safeError.code, safeError.message, 500);
  }
  return safeErrorResponse("unknown", "Psychiatrist message request failed.", 500);
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

async function defaultResolveActiveContentHash(input: {
  context: PsychiatristMemoryContext;
  manifest: PsychiatristThreadManifest;
}): Promise<string> {
  return input.context.contentHash;
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
  if (code === "thread_not_found") {
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
