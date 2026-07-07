import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { ResolvedTraumaConfig } from "../config";
import type {
  PsychiatristStreamEvent,
  PsychiatristStreamEventInput,
} from "./types";

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type StreamSubscriber = (event: PsychiatristStreamEvent) => void;
const appendQueuesByPath = new Map<string, Promise<void>>();
const nextEventNumbersByPath = new Map<string, number>();
const subscribersByTurnId = new Map<string, Set<StreamSubscriber>>();
const MAX_SAFE_PROCESS_TEXT_LENGTH = 240;

export async function appendPsychiatristStreamEvent<TData>(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  event: PsychiatristStreamEventInput<TData>;
}): Promise<PsychiatristStreamEvent<TData> | undefined> {
  const projectedInput = projectSafeStreamEvent(input.event);
  if (projectedInput === undefined) {
    return undefined;
  }
  const path = streamPath(input.config, projectedInput);
  let written: PsychiatristStreamEvent<TData> | undefined;
  const previous = appendQueuesByPath.get(path) ?? Promise.resolve();
  const next = previous.then(async () => {
    const eventNumber = nextEventNumbersByPath.get(path) ??
      await countExistingStreamEvents(path) + 1;
    const event = {
      ...projectedInput,
      eventId: String(eventNumber).padStart(12, "0"),
      timestamp: Date.now(),
    } satisfies PsychiatristStreamEvent<TData>;
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
    nextEventNumbersByPath.set(path, eventNumber + 1);
    publishStreamEvent(event);
    written = event;
  });
  const tracked = next.catch(() => undefined);
  appendQueuesByPath.set(path, tracked);
  try {
    await next;
    return written;
  } finally {
    if (appendQueuesByPath.get(path) === tracked) {
      appendQueuesByPath.delete(path);
    }
  }
}

export function subscribePsychiatristStream(input: {
  onEvent: StreamSubscriber;
  turnId: string;
}): () => void {
  validateSafeId(input.turnId);
  let subscribers = subscribersByTurnId.get(input.turnId);
  if (subscribers === undefined) {
    subscribers = new Set();
    subscribersByTurnId.set(input.turnId, subscribers);
  }
  subscribers.add(input.onEvent);
  return () => {
    subscribers?.delete(input.onEvent);
    if (subscribers?.size === 0) {
      subscribersByTurnId.delete(input.turnId);
    }
  };
}

export async function loadPsychiatristStreamReplay(input: {
  afterEventId?: string;
  config: Pick<ResolvedTraumaConfig, "storePath">;
  threadId?: string;
  turnId: string;
}): Promise<PsychiatristStreamEvent[]> {
  if (input.threadId !== undefined) {
    validateSafeId(input.threadId);
  }
  validateSafeId(input.turnId);
  const path = findStreamPath(input.config, input.threadId, input.turnId);
  if (path === undefined) {
    return [];
  }
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const events = content.trim() === ""
    ? []
    : content.trim().split("\n").map((line) => JSON.parse(line) as PsychiatristStreamEvent);
  if (input.afterEventId === undefined) {
    return events;
  }
  return events.filter((event) => event.eventId > input.afterEventId!);
}

function streamPath(
  config: Pick<ResolvedTraumaConfig, "storePath">,
  event: Pick<PsychiatristStreamEventInput, "memoryId" | "threadId" | "turnId">,
): string {
  validateSafeId(event.memoryId);
  validateSafeId(event.threadId);
  validateSafeId(event.turnId);
  return join(
    resolve(config.storePath),
    "memories",
    event.memoryId,
    "threads",
    event.threadId,
    "streams",
    `${event.turnId}.jsonl`,
  );
}

function findStreamPath(
  config: Pick<ResolvedTraumaConfig, "storePath">,
  threadId: string | undefined,
  turnId: string,
): string | undefined {
  const root = join(resolve(config.storePath), "memories");
  if (!existsSync(root)) {
    return undefined;
  }
  const glob = new Bun.Glob(
    threadId === undefined
      ? `*/threads/*/streams/${turnId}.jsonl`
      : `*/threads/${threadId}/streams/${turnId}.jsonl`,
  );
  const match = glob.scanSync({ cwd: root }).next().value;
  return typeof match === "string" ? join(root, match) : undefined;
}

async function countExistingStreamEvents(path: string): Promise<number> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
  if (content.trim() === "") {
    return 0;
  }
  return content.endsWith("\n")
    ? content.split("\n").length - 1
    : content.split("\n").length;
}

function projectSafeStreamEvent<TData>(
  event: PsychiatristStreamEventInput<TData>,
): PsychiatristStreamEventInput<TData> | undefined {
  switch (event.type) {
    case "psychiatrist.turn.started":
    case "psychiatrist.regenerate.started": {
      const status = readSafeProcessText(readStringField(event.data, "status"));
      const pairId = readStringField(event.data, "pair_id");
      const userPrompt = readStringField(event.data, "user_prompt");
      return {
        ...event,
        data: omitUndefined({
          pair_id: pairId,
          status: status ?? "running",
          user_prompt: userPrompt,
        }) as TData,
      };
    }
    case "psychiatrist.process.delta": {
      const text = readProcessText(event.data);
      if (text === undefined) {
        return undefined;
      }
      return {
        ...event,
        data: { text } as TData,
      };
    }
    case "psychiatrist.answer.delta": {
      const text = readStringField(event.data, "text");
      if (text === undefined) {
        return undefined;
      }
      return {
        ...event,
        data: { text } as TData,
      };
    }
    case "psychiatrist.answer.completed":
    case "psychiatrist.regenerate.completed": {
      const pairId = readStringField(event.data, "pair_id");
      if (pairId === undefined) {
        return undefined;
      }
      const text = readStringField(event.data, "text");
      const sourceCitations = readSourceCitations(event.data);
      const warning = readSafeWarning(event.data);
      return {
        ...event,
        data: omitUndefined({
          pair_id: pairId,
          source_citations: sourceCitations,
          text,
          warning,
        }) as TData,
      };
    }
    case "psychiatrist.answer.failed": {
      const code = readStringField(event.data, "code");
      const message = readSafeProcessText(readStringField(event.data, "message"));
      const pairId = readStringField(event.data, "pair_id");
      if (code === undefined) {
        return undefined;
      }
      return {
        ...event,
        data: omitUndefined({ code, message, pair_id: pairId }) as TData,
      };
    }
    case "psychiatrist.turn.canceled": {
      const code = readStringField(event.data, "code");
      const status = readSafeProcessText(readStringField(event.data, "status"));
      const warning = readSafeWarning(event.data);
      return {
        ...event,
        data: omitUndefined({
          code: code ?? "turn_canceled",
          status,
          warning,
        }) as TData,
      };
    }
    case "psychiatrist.thread.stale": {
      const code = readStringField(event.data, "code");
      const pairId = readStringField(event.data, "pair_id");
      const status = readSafeProcessText(readStringField(event.data, "status"));
      return {
        ...event,
        data: omitUndefined({
          code: code ?? "thread_stale",
          pair_id: pairId,
          status,
        }) as TData,
      };
    }
    case "psychiatrist.network.permission_required": {
      const code = readStringField(event.data, "code");
      const pairId = readStringField(event.data, "pair_id");
      if (code === undefined || pairId === undefined) {
        return undefined;
      }
      const message = readSafeProcessText(readStringField(event.data, "message"));
      const retryAction = readStringField(event.data, "retry_action");
      const retryMode = readStringField(event.data, "retry_mode");
      const retryTurnId = readStringField(event.data, "retry_turn_id");
      const userPrompt = readStringField(event.data, "user_prompt");
      return {
        ...event,
        data: omitUndefined({
          code,
          message,
          pair_id: pairId,
          retry_action: retryAction,
          retry_mode: retryMode,
          retry_turn_id: retryTurnId,
          user_prompt: userPrompt,
        }) as TData,
      };
    }
  }
  const _exhaustive: never = event.type;
  void _exhaustive;
  return undefined;
}

function readSafeProcessText(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const text = value.trim().replace(/\s+/g, " ");
  if (text === "") {
    return undefined;
  }
  const normalized = text.toLowerCase();
  if (
    normalized.includes("chain-of-thought") ||
    normalized.includes("chain of thought") ||
    normalized.includes("hidden reasoning") ||
    containsAbsolutePath(text) ||
    containsSensitiveHomeRelativePath(text) ||
    containsPrivateKeyFilename(text) ||
    containsSensitiveProcessText(text) ||
    normalized.includes("credential") ||
    normalized.includes("token")
  ) {
    return undefined;
  }
  return text.length > MAX_SAFE_PROCESS_TEXT_LENGTH
    ? `${text.slice(0, MAX_SAFE_PROCESS_TEXT_LENGTH - 3)}...`
    : text;
}

function containsSensitiveProcessText(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized.includes("secret") ||
    normalized.includes("password") ||
    normalized.includes("passphrase") ||
    normalized.includes("private key") ||
    normalized.includes("api key") ||
    normalized.includes("apikey") ||
    normalized.includes("access key") ||
    normalized.includes("authorization") ||
    /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/i.test(value) ||
    /\b(?:sk|pk|rk|sess)-[A-Za-z0-9_-]{8,}\b/i.test(value) ||
    /\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{12,}\b/i.test(value) ||
    /\b(?:secret|password|passwd|pwd|api[_-]?key|access[_-]?key|private[_-]?key|bearer)\b\s*[:=]\s*\S+/i
      .test(value);
}

function readSafeWarning(data: unknown): { code: string; message?: string } | undefined {
  if (!isRecord(data) || !isRecord(data.warning)) {
    return undefined;
  }
  const code = readStringField(data.warning, "code");
  if (code === undefined) {
    return undefined;
  }
  return omitUndefined({
    code,
    message: readSafeProcessText(readStringField(data.warning, "message")),
  });
}

function readSourceCitations(
  data: unknown,
): Array<{ source_id: string; title: string; url: string }> | undefined {
  if (!isRecord(data) || !Array.isArray(data.source_citations)) {
    return undefined;
  }
  const citations: Array<{ source_id: string; title: string; url: string }> = [];
  for (const citation of data.source_citations) {
    if (!isRecord(citation)) {
      return undefined;
    }
    const sourceId = readStringField(citation, "source_id");
    const title = readStringField(citation, "title");
    const url = readStringField(citation, "url");
    if (sourceId === undefined || title === undefined || url === undefined) {
      return undefined;
    }
    citations.push({ source_id: sourceId, title, url });
  }
  return citations;
}

function omitUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
}

function containsAbsolutePath(value: string): boolean {
  return /(^|[\s("'`:=])\s*\/(?:[A-Za-z0-9._-]+\/)+[^\s)"'`]*/.test(value) ||
    /(^|[\s("'`:=])\s*[A-Za-z]:[\\/](?:[^\s)"'`]+[\\/]?)+/.test(value) ||
    /(^|[\s("'`:=])\s*\\\\[^\\/\s)"'`]+[\\/][^\s)"'`]+/.test(value);
}

function containsSensitiveHomeRelativePath(value: string): boolean {
  const matches = value.matchAll(/(^|[\s("'`])~[\\/][^\s)"'`]*/g);
  for (const match of matches) {
    const path = match[0].trim().replace(/^["'(`]+/, "").toLowerCase();
    if (
      /(?:^|[\\/])(?:auth|credential|credentials|secret|secrets|password|passwd|token|tokens)(?:\.json|\.env|\.txt|\.pem|\.key)?(?:$|[\\/])/
        .test(path) ||
      /(?:^|[\\/])(?:api[_-]?key|access[_-]?key|private[_-]?key)(?:\.json|\.env|\.txt|\.pem|\.key)?(?:$|[\\/])/
        .test(path)
    ) {
      return true;
    }
    if (containsPrivateKeyFilename(path)) {
      return true;
    }
  }
  return false;
}

function containsPrivateKeyFilename(value: string): boolean {
  return /(?:^|[\\/])(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)(?:$|[.\s)"'`\\/])/.test(value) ||
    /(?:^|[\\/])[^\\/]*private[_-]?key(?:\.(?:pem|key|txt))?(?:$|[.\s)"'`\\/])/
      .test(value.toLowerCase());
}

function publishStreamEvent(event: PsychiatristStreamEvent): void {
  const subscribers = subscribersByTurnId.get(event.turnId);
  if (subscribers === undefined) {
    return;
  }
  for (const subscriber of subscribers) {
    subscriber(event);
  }
}

function readProcessText(data: unknown): string | undefined {
  return readSafeProcessText(readStringField(data, "text"));
}

function readStringField(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === "string"
    ? value[key]
    : undefined;
}

function validateSafeId(id: string): void {
  if (!UUID_V7_PATTERN.test(id)) {
    throw new Error("Expected UUID v7 id.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
