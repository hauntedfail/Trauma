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

const MAX_REPLAY_EVENTS_PER_JOB = 500;

export class TranslationEventBus {
  private nextEventId = 1;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly replay = new Map<string, TranslationEventEnvelope[]>();

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

    const history = this.replay.get(input.jobId) ?? [];
    history.push(event);
    if (history.length > MAX_REPLAY_EVENTS_PER_JOB) {
      history.splice(0, history.length - MAX_REPLAY_EVENTS_PER_JOB);
    }
    this.replay.set(input.jobId, history);

    for (const listener of this.listeners.get(input.jobId) ?? []) {
      listener(event);
    }

    return event;
  }

  getReplay(jobId: string): TranslationEventEnvelope[] {
    return [...(this.replay.get(jobId) ?? [])];
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
