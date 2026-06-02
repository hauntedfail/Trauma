export interface PsychiatristMemoryContext {
  categories: string[];
  contentHash: string;
  langCode?: string;
  memoryId: string;
  relativePath: string;
  sections: PsychiatristContextSection[];
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
