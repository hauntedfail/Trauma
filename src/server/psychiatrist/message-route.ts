import type { APIEvent } from "@solidjs/start/server";
import { randomBytes } from "node:crypto";

import {
  createNoopMemoryBackupQueue,
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
import { createSha256ContentHash } from "../translation/hash";
import { buildPsychiatristMemoryContext, PsychiatristContextError } from "./context";
import { buildPsychiatristPrompt } from "./prompt";
import { sanitizePsychiatristSourceCitations } from "./source-citations";
import { appendPsychiatristStreamEvent } from "./stream-store";
import { activePsychiatristTurns } from "./active-turns";
import {
  appendAssistantResponse,
  appendPendingPair,
  loadPsychiatristThread,
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

export const PSYCHIATRIST_MAX_USER_MESSAGE_CHARS = 4_000;
type BuildContext = typeof buildPsychiatristMemoryContext;
type MessagePayload =
  | {
      ok: true;
      message: string;
      webSourcePermission: "deny" | "allow_for_this_turn";
    }
  | { ok: false; message: string };

type ResolveActiveContentHash = (input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  context: PsychiatristMemoryContext;
  manifest: PsychiatristThreadManifest;
}) => Promise<string>;

export function createSendPsychiatristMessageHandler(input: {
  backupQueue?: MemoryBackupQueue;
  buildContext?: BuildContext;
  client?: CodexConversationClient;
  config?: Pick<ResolvedTraumaConfig, "storePath">;
  generateId?: () => string;
  loadThread?: typeof loadPsychiatristThread;
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
    backupQueue?: MemoryBackupQueue;
    buildContext?: BuildContext;
    client?: CodexConversationClient;
    config?: Pick<ResolvedTraumaConfig, "storePath">;
    generateId?: () => string;
    loadThread?: typeof loadPsychiatristThread;
    now?: () => Date;
    resolveActiveContentHash?: ResolveActiveContentHash;
  } = {},
): Promise<Response> {
  const threadId = event.params.threadId?.trim();
  if (threadId === undefined || threadId === "") {
    return safeErrorResponse("invalid_request", "threadId must be a non-empty string.", 400);
  }
  const payload = await parseMessagePayload(event.request);
  if (!payload.ok) {
    return safeErrorResponse("invalid_request", payload.message, 400);
  }
  if (!activePsychiatristTurns.reserveThread(threadId)) {
    return safeErrorResponse(
      "turn_conflict",
      "A Psychiatrist turn is already running for this thread.",
      409,
    );
  }

  const config = input.config ?? loadRuntimeTraumaConfig();
  const loadThread = input.loadThread ?? loadPsychiatristThread;
  let thread: { manifest: PsychiatristThreadManifest; pairs: PsychiatristThreadPair[] };
  try {
    thread = await loadThread({ config, threadId });
  } catch (error) {
    activePsychiatristTurns.releaseThread(threadId);
    return formatMessageError(error);
  }
  if (thread.manifest.status === "stale") {
    activePsychiatristTurns.releaseThread(threadId);
    return safeErrorResponse(
      "thread_stale",
      "Psychiatrist thread is stale. Refresh the thread and retry.",
      409,
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
    activePsychiatristTurns.releaseThread(threadId);
    return formatMessageError(error);
  }
  if (activeContentHash !== thread.manifest.activeContentHash) {
    activePsychiatristTurns.releaseThread(threadId);
    await markPsychiatristThreadStale({ config, threadId });
    await appendPsychiatristStreamEvent({
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
  const contextSnapshot = createContextSnapshot({
    context,
    manifest: thread.manifest,
    pairId,
    prompt: payload.message,
  });
  const webSourcePolicy: PsychiatristWebSourcePolicy =
    payload.webSourcePermission === "allow_for_this_turn"
      ? { allowed: true, reason: "user_approved_for_turn" }
      : { allowed: false, reason: "default_denied" };

  try {
    await appendPendingPair({
      config,
      contextSnapshot,
      pairId,
      prompt: payload.message,
      threadId,
      turnId,
    });
    await recordPsychiatristTurnStarted({
      config,
      pairId,
      threadId,
      turnId,
    });
    await appendPsychiatristStreamEvent({
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
    const client = input.client ?? new CodexAppServerClient();
    activePsychiatristTurns.register({
      client,
      memoryId: thread.manifest.memoryId,
      pairId,
      threadId,
      turnId,
    });
    void runPsychiatristTurn({
      backupQueue: input.backupQueue ?? resolveBackupQueue(config),
      client,
      config,
      context,
      pairId,
      payload,
      thread,
      threadId,
      turnId,
      webSourcePolicy,
      ownsClient,
    });
    return jsonResponse(toStartedResponse({ pairId, threadId, turnId }), {
      status: 202,
    });
  } catch (error) {
    activePsychiatristTurns.unregister(turnId);
    activePsychiatristTurns.releaseThread(threadId);
    await appendPsychiatristStreamEvent({
      config,
      event: {
        data: { code: "unknown", message: "Psychiatrist answer failed." },
        memoryId: thread.manifest.memoryId,
        threadId,
        turnId,
        type: "psychiatrist.answer.failed",
      },
    });
    return formatMessageError(error);
  }
}

async function runPsychiatristTurn(input: {
  backupQueue: MemoryBackupQueue;
  client: CodexConversationClient;
  config: Pick<ResolvedTraumaConfig, "storePath">;
  context: PsychiatristMemoryContext;
  pairId: string;
  payload: { message: string };
  ownsClient: boolean;
  thread: { manifest: PsychiatristThreadManifest; pairs: PsychiatristThreadPair[] };
  threadId: string;
  turnId: string;
  webSourcePolicy: PsychiatristWebSourcePolicy;
}): Promise<void> {
  try {
    const prompt = buildPsychiatristPrompt({
      context: input.context,
      contextSnapshotId: input.pairId,
      pairs: input.thread.pairs,
      threadId: input.threadId,
      userMessage: input.payload.message,
      webSourcePolicy: input.webSourcePolicy,
    });
    let eventWriteChain = Promise.resolve();
    const result = await input.client.runConversationTurn({
      cwdPurpose: "psychiatrist",
      input: prompt,
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
            memoryId: input.thread.manifest.memoryId,
            threadId: input.threadId,
            turnId: input.turnId,
          }),
        );
      },
      threadId: input.thread.manifest.codexThreadId,
    });
    await eventWriteChain;
    if (!input.webSourcePolicy.allowed && result.webSourceRequired === true) {
      const safeError = {
        action: "retry" as const,
        code: "network_permission_required",
        message: "Allow web-source access to answer this request.",
      };
      await markPsychiatristTurnFailed({
        codexThreadId: result.threadId,
        codexTurnId: result.turnId,
        config: input.config,
        error: safeError,
        pairId: input.pairId,
        threadId: input.threadId,
        turnId: input.turnId,
      });
      await appendPsychiatristStreamEvent({
        config: input.config,
        event: {
          data: {
            code: safeError.code,
            message: safeError.message,
            pair_id: input.pairId,
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
    await appendAssistantResponse({
      assistantResponse: result.outputText,
      citations: sanitizePsychiatristSourceCitations(result.sourceCitations),
      config: input.config,
      pairId: input.pairId,
      threadId: input.threadId,
      webSourcePolicy: input.webSourcePolicy,
    });
    await markPsychiatristTurnCompleted({
      codexThreadId: result.threadId,
      codexTurnId: result.turnId,
      config: input.config,
      pairId: input.pairId,
      threadId: input.threadId,
      turnId: input.turnId,
    });
    const backupWarning = await enqueueCompletedAnswerBackup(input)
      .then(() => undefined)
      .catch(() => ({
        code: "backup_enqueue_failed",
        message: "Psychiatrist answer was saved, but backup enqueue failed.",
      }));
    await appendPsychiatristStreamEvent({
      config: input.config,
      event: {
        data: {
          ...(backupWarning === undefined ? {} : { warning: backupWarning }),
          pair_id: input.pairId,
        },
        memoryId: input.thread.manifest.memoryId,
        threadId: input.threadId,
        turnId: input.turnId,
        type: "psychiatrist.answer.completed",
      },
    });
  } catch (error) {
    const active = activePsychiatristTurns.getByTurnId(input.turnId);
    if (error instanceof CodexAppServerError && error.code === "turn_interrupted") {
      return;
    }
    const safeError = toSafeCodexError(error, "Psychiatrist answer failed.");
    await markPsychiatristTurnFailed({
      codexThreadId: active?.codexThreadId,
      codexTurnId: active?.codexTurnId,
      config: input.config,
      error: safeError,
      pairId: input.pairId,
      threadId: input.threadId,
      turnId: input.turnId,
    });
    await appendPsychiatristStreamEvent({
      config: input.config,
      event: {
        data: { code: safeError.code, message: safeError.message },
        memoryId: input.thread.manifest.memoryId,
        threadId: input.threadId,
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

async function closeOwnedClient(client: CodexConversationClient): Promise<void> {
  try {
    await client.close?.();
  } catch {
    // A close failure must not rewrite the persisted turn outcome.
  }
}

async function enqueueCompletedAnswerBackup(input: {
  backupQueue: MemoryBackupQueue;
  pairId: string;
  thread: { manifest: PsychiatristThreadManifest };
  threadId: string;
}): Promise<void> {
  await input.backupQueue.enqueue({
    contentPaths: [
      `memories/${input.thread.manifest.memoryId}/threads/${input.threadId}/THREAD.md`,
      `memories/${input.thread.manifest.memoryId}/threads/${input.threadId}/pairs/${input.pairId}/PROMPT.md`,
      `memories/${input.thread.manifest.memoryId}/threads/${input.threadId}/pairs/${input.pairId}/CONTEXT.json`,
      `memories/${input.thread.manifest.memoryId}/threads/${input.threadId}/pairs/${input.pairId}/RESPONSE.md`,
      `memories/${input.thread.manifest.memoryId}/threads/${input.threadId}/PAIRS.jsonl`,
    ],
    memoryId: input.thread.manifest.memoryId,
    reason: "psychiatrist_thread_update",
  });
}

function resolveBackupQueue(
  config: Pick<ResolvedTraumaConfig, "storePath">,
): MemoryBackupQueue {
  return "backup" in config
    ? getMemoryBackupQueue(config as ResolvedTraumaConfig)
    : createNoopMemoryBackupQueue();
}

async function parseMessagePayload(request: Request): Promise<MessagePayload> {
  let payload: unknown;
  try {
    payload = JSON.parse(await request.text());
  } catch {
    return { ok: false, message: "request body must be JSON." };
  }
  if (!isRecord(payload)) {
    return { ok: false, message: "request body must be an object." };
  }
  if (typeof payload.message !== "string" || payload.message.trim() === "") {
    return { ok: false, message: "message must be a non-empty string." };
  }
  const message = payload.message.trim();
  if (message.length > PSYCHIATRIST_MAX_USER_MESSAGE_CHARS) {
    return { ok: false, message: "message must be 4000 characters or fewer." };
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
  return { ok: true, message, webSourcePermission };
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
    ...(input.manifest.langCode === undefined
      ? {}
      : { langCode: input.manifest.langCode }),
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
    ...(input.manifest.translationOutputHash === undefined
      ? {}
      : { translationOutputHash: input.manifest.translationOutputHash }),
    userPrompt: input.prompt,
    variantKind: input.manifest.variantKind,
  };
}

async function resolveTurnContext(input: {
  buildContext?: BuildContext;
  config: Pick<ResolvedTraumaConfig, "storePath">;
  manifest: PsychiatristThreadManifest;
}): Promise<PsychiatristMemoryContext> {
  if (input.buildContext !== undefined) {
    return await input.buildContext({
      config: input.config,
      langCode: input.manifest.langCode,
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
      langCode: input.manifest.langCode,
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
    variantKind: manifest.variantKind,
  };
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

function toStartedResponse(input: {
  pairId: string;
  threadId: string;
  turnId: string;
}) {
  const eventUrl = `/api/psychiatrist-turns/${input.turnId}/events`;
  return {
    event_url: eventUrl,
    pair_id: input.pairId,
    replay_url: eventUrl,
    status: "started",
    thread_id: input.threadId,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
