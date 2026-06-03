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
  type CodexAppServerEvent,
  type CodexConversationClient,
} from "../translation/codex-app-server";
import { createSha256ContentHash } from "../translation/hash";
import { buildPsychiatristMemoryContext } from "./context";
import { buildPsychiatristPrompt } from "./prompt";
import { sanitizePsychiatristSourceCitations } from "./source-citations";
import { appendPsychiatristStreamEvent } from "./stream-store";
import { activePsychiatristTurns } from "./active-turns";
import {
  appendAssistantResponse,
  appendPendingPair,
  loadPsychiatristThread,
  markPsychiatristTurnFailed,
  markPsychiatristThreadStale,
  PsychiatristThreadStoreError,
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
  if (activePsychiatristTurns.getByThreadId(threadId) !== undefined) {
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
    return formatMessageError(error);
  }

  const pairId = input.generateId?.() ?? generateUuidV7Like();
  const turnId = input.generateId?.() ?? generateUuidV7Like();
  const context = await resolveTurnContext({
    buildContext: input.buildContext,
    config,
    manifest: thread.manifest,
  });
  const resolveActiveContentHash = input.resolveActiveContentHash ??
    defaultResolveActiveContentHash;
  const activeContentHash = await resolveActiveContentHash({
    config,
    context,
    manifest: thread.manifest,
  });
  if (activeContentHash !== thread.manifest.activeContentHash) {
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
    await appendPsychiatristStreamEvent({
      config,
      event: {
        data: { status: "running" },
        memoryId: thread.manifest.memoryId,
        threadId,
        turnId,
        type: "psychiatrist.turn.started",
      },
    });

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
    });
    return jsonResponse(toStartedResponse({ pairId, threadId, turnId }), {
      status: 202,
    });
  } catch (error) {
    activePsychiatristTurns.unregister(turnId);
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
    await appendAssistantResponse({
      assistantResponse: result.outputText,
      citations: sanitizePsychiatristSourceCitations(result.sourceCitations),
      config: input.config,
      pairId: input.pairId,
      threadId: input.threadId,
    });
    await enqueueCompletedAnswerBackup(input).catch(() => undefined);
    await appendPsychiatristStreamEvent({
      config: input.config,
      event: {
        data: { pair_id: input.pairId },
        memoryId: input.thread.manifest.memoryId,
        threadId: input.threadId,
        turnId: input.turnId,
        type: "psychiatrist.answer.completed",
      },
    });
  } catch {
    const active = activePsychiatristTurns.getByTurnId(input.turnId);
    await markPsychiatristTurnFailed({
      codexThreadId: active?.codexThreadId,
      codexTurnId: active?.codexTurnId,
      config: input.config,
      error: {
        action: "retry",
        code: "unknown",
        message: "Psychiatrist answer failed.",
      },
      pairId: input.pairId,
      threadId: input.threadId,
      turnId: input.turnId,
    });
    await appendPsychiatristStreamEvent({
      config: input.config,
      event: {
        data: { code: "unknown", message: "Psychiatrist answer failed." },
        memoryId: input.thread.manifest.memoryId,
        threadId: input.threadId,
        turnId: input.turnId,
        type: "psychiatrist.answer.failed",
      },
    });
  } finally {
    activePsychiatristTurns.unregister(input.turnId);
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
    contentHash: input.context.contentHash,
    contextSnapshotId: input.pairId,
    ...(input.manifest.langCode === undefined
      ? {}
      : { langCode: input.manifest.langCode }),
    memoryId: input.manifest.memoryId,
    policyVersion: input.manifest.policyVersion,
    selectedSectionAnchors: input.context.sections.map((section) => section.anchor),
    selectedSectionHashes: input.context.sections.map((section) =>
      createSha256ContentHash(section.markdown)
    ),
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
  return safeErrorResponse("unknown", "Psychiatrist message request failed.", 500);
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

function safeErrorAction(code: string): "allow_web_sources" | "open_reader" | "refresh_thread" | "retry" {
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
