import { getLengthBucket } from "../../components/memories/browse-data";
import type { MemoryBrowsePageRow } from "../db/repositories";
import { jsonResponse } from "../http/json";
import type {
  AgentActiveMemorySummary,
  AgentContextMemoryItem,
} from "./types";

export function extractDomain(rawUrl: string): string {
  try {
    const hostname = new URL(rawUrl).hostname.replace(/^www\./i, "");
    return hostname.length > 0 ? hostname : rawUrl;
  } catch {
    return rawUrl;
  }
}

export function toAgentContextItem(
  row: MemoryBrowsePageRow,
): AgentContextMemoryItem {
  return {
    id: row.id,
    title: row.title,
    domain: extractDomain(row.url),
    lengthBucket: getLengthBucket(row.wordCount),
    lastPosition: row.lastPosition,
    triageState: row.triageState,
  };
}

export function toAgentActiveMemorySummary(
  row: MemoryBrowsePageRow,
): AgentActiveMemorySummary | null {
  if (row.lastOpenedAt === null) {
    return null;
  }

  return {
    ...toAgentContextItem(row),
    lastOpenedAt: row.lastOpenedAt,
    read: row.read,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function agentErrorResponse(
  error: string,
  status: number,
  extra?: Record<string, unknown>,
  headers?: HeadersInit,
): Response {
  return jsonResponse(
    {
      error,
      ...extra,
    },
    { status, headers },
  );
}
