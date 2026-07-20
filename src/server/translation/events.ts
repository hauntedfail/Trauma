import type {
  TranslationEventEnvelope,
  TranslationEventType,
} from "./types";

export interface EmitTranslationEventInput<TData = unknown> {
  chunkIndex?: number | null;
  data: TData;
  jobId: string;
  langCode: string;
  memoryId: string;
  type: TranslationEventType;
}

type Listener = (event: TranslationEventEnvelope) => void;

export interface TranslationReplayLimits {
  maxReplayBytes: number;
  maxReplayEvents: number;
}

export const TRANSLATION_REPLAY_LIMITS = Object.freeze({
  maxReplayBytes: 4 * 1_024 * 1_024,
  maxReplayEvents: 500,
}) satisfies TranslationReplayLimits;

interface ReplayHistory {
  bytes: number;
  entries: Array<{
    bytes: number;
    event: TranslationEventEnvelope;
  }>;
}

const TERMINAL_TRANSLATION_EVENT_TYPES = new Set<TranslationEventType>([
  "translation.job.canceled",
  "translation.job.completed",
  "translation.job.failed",
  "translation.job.stale",
]);

export function isTerminalTranslationEventType(
  type: TranslationEventType,
): boolean {
  return TERMINAL_TRANSLATION_EVENT_TYPES.has(type);
}

export class TranslationEventBus {
  private nextEventId = 1;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly replay = new Map<string, ReplayHistory>();

  constructor(
    private readonly replayLimits: TranslationReplayLimits =
      TRANSLATION_REPLAY_LIMITS,
  ) {
    validateReplayLimits(replayLimits);
  }

  emit<TData>(input: EmitTranslationEventInput<TData>): TranslationEventEnvelope<TData> {
    const event = {
      id: String(this.nextEventId).padStart(12, "0"),
      type: input.type,
      job_id: input.jobId,
      memory_id: input.memoryId,
      lang_code: input.langCode,
      chunk_index: input.chunkIndex ?? null,
      timestamp: Date.now(),
      data: input.data,
    } satisfies TranslationEventEnvelope<TData>;
    this.nextEventId += 1;

    const eventBytes = measureTranslationEventEnvelopeBytes(event);
    const history = this.replay.get(input.jobId) ?? { bytes: 0, entries: [] };
    history.entries.push({ bytes: eventBytes, event });
    history.bytes += eventBytes;
    while (
      history.entries.length > this.replayLimits.maxReplayEvents ||
      history.bytes > this.replayLimits.maxReplayBytes
    ) {
      const evicted = history.entries.shift();
      if (evicted === undefined) {
        break;
      }
      history.bytes -= evicted.bytes;
    }
    this.replay.set(input.jobId, history);

    for (const listener of this.listeners.get(input.jobId) ?? []) {
      listener(event);
    }
    if (isTerminalTranslationEventType(input.type)) {
      this.replay.delete(input.jobId);
    }

    return event;
  }

  getReplay(jobId: string): TranslationEventEnvelope[] {
    return (this.replay.get(jobId)?.entries ?? []).map((entry) => entry.event);
  }

  subscribeWithReplay(
    jobId: string,
    listener: Listener,
  ): { replay: TranslationEventEnvelope[]; unsubscribe: () => void } {
    const replay = this.getReplay(jobId);
    const unsubscribe = this.subscribe(jobId, listener);
    return { replay, unsubscribe };
  }

  subscribe(jobId: string, listener: Listener): () => void {
    const listeners = this.listeners.get(jobId) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(jobId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.listeners.delete(jobId);
      }
    };
  }
}

export const translationEventBus = new TranslationEventBus();

export function encodeServerSentEvent(event: TranslationEventEnvelope): string {
  return [
    `id: ${event.id}`,
    `event: ${event.type}`,
    `data: ${JSON.stringify(event)}`,
    "",
    "",
  ].join("\n");
}

export function measureTranslationEventEnvelopeBytes(
  event: TranslationEventEnvelope,
): number {
  const serialized = JSON.stringify(event);
  if (serialized === undefined) {
    throw new TypeError("Translation event must be JSON serializable.");
  }
  return Buffer.byteLength(serialized, "utf8");
}

function validateReplayLimits(limits: TranslationReplayLimits): void {
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError(
        "Translation replay limits must be positive safe integers.",
      );
    }
  }
}
