export interface PsychiatristMemoryContext {
  categories: string[];
  contentHash: string;
  langCode?: string;
  memoryId: string;
  relativePath: string;
  sections: PsychiatristContextSection[];
  sourceHash: string;
  sourceUrl: string;
  tags: string[];
  title: string;
  variantKind: "source" | "translation";
}

export interface PsychiatristContextSection {
  anchor: string;
  endOffset: number;
  level: number;
  markdown: string;
  path: string;
  startOffset: number;
  title: string;
}

export interface PsychiatristPromptInput {
  context: PsychiatristMemoryContext;
  contextSnapshotId: string;
  pairs: PsychiatristThreadPair[];
  regenerate?: PsychiatristRegenerateInput;
  threadId: string;
  userMessage: string;
  webSourcePolicy: PsychiatristWebSourcePolicy;
}

export interface PsychiatristRegenerateInput {
  originalPairId: string;
  originalTurnId: string;
  reason: "user_requested_regenerate";
}

export interface PsychiatristThreadPair {
  assistant?: PsychiatristPairAssistant;
  pairId: string;
  status: "pending" | "completed" | "failed" | "canceled" | "stale";
  turnId: string;
  user: PsychiatristPairUser;
}

export interface PsychiatristPairUser {
  content: string;
  createdAt: string;
}

export interface PsychiatristPairAssistant {
  citations: PsychiatristSourceCitation[];
  completedAt: string;
  content: string;
}

export interface PsychiatristSourceCitation {
  sourceId: string;
  title: string;
  url: string;
}

export interface PsychiatristWebSourcePolicy {
  allowed: boolean;
  reason: "default_denied" | "user_approved_for_turn";
}

export interface PsychiatristThreadManifest {
  activeContentHash: string;
  codexThreadId?: string;
  createdAt: string;
  langCode?: string;
  memoryId: string;
  policyVersion: string;
  sourceHash: string;
  status: "ready" | "running" | "stale" | "failed" | "canceled";
  threadId: string;
  translationOutputHash?: string;
  updatedAt: string;
  variantKind: "source" | "translation";
}

export interface PsychiatristContextSnapshotManifest {
  categories: string[];
  contentHash: string;
  contextSnapshotId: string;
  langCode?: string;
  memoryId: string;
  policyVersion: string;
  relativePath: string;
  selectedSectionAnchors: string[];
  selectedSectionHashes: string[];
  sections: PsychiatristContextSection[];
  sourceUrl: string;
  tags: string[];
  title: string;
  translationOutputHash?: string;
  userPrompt: string;
  variantKind: "source" | "translation";
}

export type PsychiatristStreamEventType =
  | "psychiatrist.turn.started"
  | "psychiatrist.process.delta"
  | "psychiatrist.answer.delta"
  | "psychiatrist.answer.completed"
  | "psychiatrist.answer.failed"
  | "psychiatrist.turn.canceled"
  | "psychiatrist.thread.stale"
  | "psychiatrist.network.permission_required"
  | "psychiatrist.regenerate.started"
  | "psychiatrist.regenerate.completed";

export interface PsychiatristStreamEventInput<TData = unknown> {
  data: TData;
  memoryId: string;
  threadId: string;
  turnId: string;
  type: PsychiatristStreamEventType;
}

export interface PsychiatristStreamEvent<TData = unknown>
  extends PsychiatristStreamEventInput<TData> {
  eventId: string;
  timestamp: number;
}
