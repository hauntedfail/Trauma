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
import { jsonResponse } from "../http/json";
import {
  CodexAppServerClient,
  type CodexAppServerEvent,
  type CodexConversationClient,
} from "../translation/codex-app-server";
import { activePsychiatristTurns } from "./active-turns";
import { buildPsychiatristPrompt } from "./prompt";
import { sanitizePsychiatristSourceCitations } from "./source-citations";
import { appendPsychiatristStreamEvent } from "./stream-store";
import {
  appendRegeneratedAssistantResponse,
  loadPsychiatristPairRegeneration,
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

export function createRegeneratePsychiatristResponseHandler(input: {
  backupQueue?: MemoryBackupQueue;
  client?: CodexConversationClient;
  config?: ResolvedTraumaConfig;
  generateId?: () => string;
  loadPair?: typeof loadPsychiatristPairRegeneration;
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
  if (activePsychiatristTurns.getByThreadId(loaded.manifest.threadId) !== undefined) {
    return safeErrorResponse(
      "turn_conflict",
      "A Psychiatrist turn is already running for this thread.",
      409,
    );
  }

  const turnId = input.generateId?.() ?? generateUuidV7Like();
  const webSourcePolicy: PsychiatristWebSourcePolicy =
    payload.webSourcePermission === "allow_for_this_turn"
      ? { allowed: true, reason: "user_approved_for_turn" }
      : { allowed: false, reason: "default_denied" };

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

  const client = input.client ?? new CodexAppServerClient();
  activePsychiatristTurns.register({
    client,
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
    pairId,
    turnId,
    webSourcePolicy,
  });

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
  pairId: string;
  turnId: string;
  webSourcePolicy: PsychiatristWebSourcePolicy;
}): Promise<void> {
  const pair = input.loaded.pair;
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
    await appendRegeneratedAssistantResponse({
      assistantResponse: result.outputText,
      citations: sanitizePsychiatristSourceCitations(result.sourceCitations),
      config: input.config,
      pairId: input.pairId,
      threadId: input.loaded.manifest.threadId,
      turnId: input.turnId,
      webSourcePolicy: input.webSourcePolicy,
    });
    await markPsychiatristTurnCompleted({
      codexThreadId: result.threadId,
      codexTurnId: result.turnId,
      config: input.config,
      pairId: input.pairId,
      regenerateFromTurnId: pair.turnId,
      threadId: input.loaded.manifest.threadId,
      turnId: input.turnId,
    });
    await appendPsychiatristStreamEvent({
      config: input.config,
      event: {
        data: { pair_id: input.pairId },
        memoryId: input.loaded.manifest.memoryId,
        threadId: input.loaded.manifest.threadId,
        turnId: input.turnId,
        type: "psychiatrist.regenerate.completed",
      },
    });
    await input.backupQueue.enqueue({
      contentPaths: [
        input.loaded.paths.threadMarkdownRelativePath,
        input.loaded.paths.pairResponseRelativePath,
        input.loaded.paths.pairRevisionLogRelativePath,
      ],
      memoryId: input.loaded.manifest.memoryId,
      reason: "psychiatrist_response_regenerate",
    });
  } catch {
    await markPsychiatristRegenerateFailed({
      config: input.config,
      error: {
        action: "retry",
        code: "unknown",
        message: "Psychiatrist regenerate failed.",
      },
      pairId: input.pairId,
      threadId: input.loaded.manifest.threadId,
      turnId: input.turnId,
    });
    await appendPsychiatristStreamEvent({
      config: input.config,
      event: {
        data: { code: "unknown", message: "Psychiatrist regenerate failed." },
        memoryId: input.loaded.manifest.memoryId,
        threadId: input.loaded.manifest.threadId,
        turnId: input.turnId,
        type: "psychiatrist.answer.failed",
      },
    });
  } finally {
    activePsychiatristTurns.unregister(input.turnId);
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
      action: code === "pair_not_found" ? "open_reader" : "retry",
      code,
      message,
      status: "error",
    },
    { status },
  );
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
