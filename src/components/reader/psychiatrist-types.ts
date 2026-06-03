export type PsychiatristWebSourcePermission = "deny" | "allow_for_this_turn";

export interface PsychiatristThreadResponse {
  active_turn: PsychiatristActiveTurnResponse | null;
  content_hash: string;
  lang_code: string | null;
  memory_id: string;
  pairs: PsychiatristThreadPairResponse[];
  status: "ready" | "running" | "stale" | "failed" | "canceled";
  thread_id: string;
  variant_kind: "source" | "translation";
}

export interface PsychiatristActiveTurnResponse {
  event_url: string;
  pair_id: string;
  status: "running";
  turn_id: string;
}

export interface PsychiatristThreadPairResponse {
  assistant_response?: {
    completed_at: string;
    content: string;
    source_citations: Array<{
      source_id: string;
      title: string;
      url: string;
    }>;
  };
  pair_id: string;
  status: "pending" | "completed" | "failed" | "canceled" | "stale";
  turn_id: string;
  user_prompt: {
    content: string;
    created_at: string;
  };
}

export interface PsychiatristTurnStartedResponse {
  event_url: string;
  pair_id: string;
  replay_url: string;
  status: "started";
  thread_id: string;
  turn_id: string;
}

export type PsychiatristStreamEventType =
  | "psychiatrist.turn.started"
  | "psychiatrist.process.delta"
  | "psychiatrist.answer.delta"
  | "psychiatrist.answer.completed"
  | "psychiatrist.answer.failed"
  | "psychiatrist.turn.canceled"
  | "psychiatrist.network.permission_required"
  | "psychiatrist.regenerate.started"
  | "psychiatrist.regenerate.completed";

export interface PsychiatristStreamEvent {
  data: unknown;
  eventId: string;
  memoryId: string;
  threadId: string;
  timestamp: number;
  turnId: string;
  type: PsychiatristStreamEventType;
}
