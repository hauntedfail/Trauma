import type { BrowseLengthBucket } from "../../components/memories/browse-data";
import type {
  MemoryLastPosition,
  MemoryTriageState,
} from "../db/repositories";
import type { ReaderTocEntry } from "../reader/markdown-renderer";
import type {
  ReaderContentVariant,
  ReaderFlashbackItem,
  ReaderMomentItem,
  ReaderTaxonomyItem,
} from "../reader/page-data";
import type { SupportedLanguageCode } from "../translation/languages";

export interface AgentContextMemoryItem {
  id: string;
  title: string;
  domain: string;
  lengthBucket: BrowseLengthBucket | null;
  lastPosition: MemoryLastPosition | null;
  triageState: MemoryTriageState;
}

export interface AgentActiveMemorySummary extends AgentContextMemoryItem {
  lastOpenedAt: string;
  read: boolean;
}

export interface AgentContextResponse {
  today: AgentContextMemoryItem[];
  shelf: AgentContextMemoryItem[];
  activeMemory: AgentActiveMemorySummary | null;
}

export interface AgentMemoryReadingStateResponse {
  id: string;
  url: string;
  domain: string;
  title: string;
  description: string | null;
  faviconUrl: string | null;
  extractionStatus: string;
  read: boolean;
  triageState: MemoryTriageState;
  triageChangedAt: string | null;
  lastPosition: MemoryLastPosition | null;
  lastOpenedAt: string | null;
  wordCount: number | null;
  lengthBucket: BrowseLengthBucket | null;
  capturedAt: string;
  createdAt: string;
  updatedAt: string;
  categories: ReaderTaxonomyItem[];
  tags: ReaderTaxonomyItem[];
  activeVariant: {
    kind: "source" | "translation";
    langCode: SupportedLanguageCode | null;
    relativePath: string;
  };
  variants: ReaderContentVariant[];
  markdown: string;
  toc: ReaderTocEntry[];
  flashbacks: ReaderFlashbackItem[];
  moments: ReaderMomentItem[];
}

export interface AgentTriageResponse {
  memoryId: string;
  triageState: MemoryTriageState;
  triageChangedAt: string;
  changed: boolean;
}

export const AGENT_ASK_ACTIONS = ["simplify", "explain", "ask"] as const;

export type AgentAskAction = (typeof AGENT_ASK_ACTIONS)[number];

export interface AgentAskGroundedContext {
  action: AgentAskAction;
  memoryId: string;
  memoryTitle: string;
  domain: string;
  variantKind: "source" | "translation";
  langCode: SupportedLanguageCode | null;
  sectionAnchor: string | null;
  sectionTitle: string | null;
  selectedText: string | null;
  prompt: string | null;
}

export interface AgentAskResponse {
  threadId: string;
  turnId: string;
  pairId: string;
  eventsUrl: string;
  groundedContext: AgentAskGroundedContext;
}
