import type { APIEvent } from "@solidjs/start/server";

import {
  loadRuntimeTraumaConfig,
  type ResolvedTraumaConfig,
} from "../config";
import { initializeDatabase } from "../db";
import { authenticateApiRequest } from "../http/api-auth";
import { formatConfigError, jsonResponse } from "../http/json";
import {
  agentErrorResponse,
  toAgentActiveMemorySummary,
  toAgentContextItem,
} from "./helpers";
import type { AgentContextResponse } from "./types";

const DEFAULT_TODAY_LIMIT = 50;
const DEFAULT_SHELF_LIMIT = 50;
const MAX_LANE_LIMIT = 100;
const ACTIVE_MEMORY_PROBE_LIMIT = 10;

export interface AgentContextHandlerDependencies {
  config?: ResolvedTraumaConfig;
}

export function createAgentContextHandler(
  deps: AgentContextHandlerDependencies = {},
) {
  return async function getAgentContext(event: APIEvent): Promise<Response> {
    return handleAgentContextRequest(event, deps);
  };
}

export async function handleAgentContextRequest(
  event: APIEvent,
  deps: AgentContextHandlerDependencies = {},
): Promise<Response> {
  const auth = authenticateApiRequest(event.request);
  if (!auth.ok) {
    return agentErrorResponse(auth.error, auth.status);
  }

  const shelfLimitResult = parseOptionalLimitParam(
    new URL(event.request.url).searchParams.get("shelfLimit"),
    DEFAULT_SHELF_LIMIT,
  );
  if (!shelfLimitResult.ok) {
    return agentErrorResponse(shelfLimitResult.error, 400);
  }

  let config: ResolvedTraumaConfig;
  try {
    config = deps.config ?? loadRuntimeTraumaConfig();
  } catch (error) {
    return agentErrorResponse(formatConfigError(error), 500);
  }

  const connection = initializeDatabase(config);
  try {
    const baseQuery = {
      categoryId: "",
      cursor: null,
      flashbackId: "",
      readState: "all" as const,
      searchFields: [],
      searchTerms: [],
      tagId: "",
    };

    const [todayPage, shelfPage, recentOpenedPage] = await Promise.all([
      connection.repositories.memories.listForBrowsePage({
        ...baseQuery,
        lane: "today",
        limit: DEFAULT_TODAY_LIMIT,
        sort: "recent",
      }),
      connection.repositories.memories.listForBrowsePage({
        ...baseQuery,
        lane: "shelf",
        limit: shelfLimitResult.limit,
        sort: "recent",
      }),
      connection.repositories.memories.listForBrowsePage({
        ...baseQuery,
        limit: ACTIVE_MEMORY_PROBE_LIMIT,
        sort: "last_opened",
      }),
    ]);

    const activeRow = recentOpenedPage.rows.find(
      (row) => row.lastOpenedAt !== null && row.triageState !== "archive",
    );

    const response: AgentContextResponse = {
      today: todayPage.rows.map(toAgentContextItem),
      shelf: shelfPage.rows.map(toAgentContextItem),
      activeMemory:
        activeRow === undefined ? null : toAgentActiveMemorySummary(activeRow),
    };

    return jsonResponse(response, { status: 200 });
  } finally {
    connection.close();
  }
}

function parseOptionalLimitParam(
  raw: string | null,
  fallback: number,
): { ok: true; limit: number } | { ok: false; error: string } {
  if (raw === null || raw.trim() === "") {
    return { ok: true, limit: fallback };
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LANE_LIMIT) {
    return {
      ok: false,
      error: `shelfLimit must be an integer between 1 and ${MAX_LANE_LIMIT}`,
    };
  }

  return { ok: true, limit: parsed };
}
