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
const subscribersByTurnId = new Map<string, Set<StreamSubscriber>>();

export async function appendPsychiatristStreamEvent<TData>(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  event: PsychiatristStreamEventInput<TData>;
}): Promise<PsychiatristStreamEvent<TData> | undefined> {
  if (!isSafeStreamEvent(input.event)) {
    return undefined;
  }
  const existing = await loadPsychiatristStreamReplay({
    config: input.config,
    threadId: input.event.threadId,
    turnId: input.event.turnId,
  });
  const event = {
    ...input.event,
    eventId: String(existing.length + 1).padStart(12, "0"),
    timestamp: Date.now(),
  } satisfies PsychiatristStreamEvent<TData>;
  const path = streamPath(input.config, input.event);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
  publishStreamEvent(event);
  return event;
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

function isSafeStreamEvent(event: PsychiatristStreamEventInput): boolean {
  if (event.type !== "psychiatrist.process.delta") {
    return true;
  }
  const text = readProcessText(event.data);
  if (text === undefined) {
    return false;
  }
  const normalized = text.toLowerCase();
  return !(
    normalized.includes("chain-of-thought") ||
    normalized.includes("chain of thought") ||
    normalized.includes("hidden reasoning") ||
    normalized.includes("/private/") ||
    normalized.includes("credential") ||
    normalized.includes("token")
  );
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
  return isRecord(data) && typeof data.text === "string" ? data.text : undefined;
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
