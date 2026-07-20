import type { APIEvent } from "@solidjs/start/server";

import { loadRuntimeTraumaConfig, TraumaConfigError } from "~/server/config";
import { initializeDatabase } from "~/server/db";
import { readJsonMutationRequest } from "~/server/http/mutation-request";

type ReadStatusPayload =
  | { ok: true; memoryId: string; read: boolean }
  | { ok: false; error: string; status?: number };

export async function POST(event: APIEvent): Promise<Response> {
  const payload = await parseReadStatusPayload(event.request);
  if (!payload.ok) {
    return json({ error: payload.error }, { status: payload.status ?? 400 });
  }

  let config;
  try {
    config = loadRuntimeTraumaConfig();
  } catch (error) {
    return json({ error: formatConfigError(error) }, { status: 500 });
  }

  const connection = initializeDatabase(config);
  try {
    const updated = await connection.repositories.memories.setReadStatus({
      memoryId: payload.memoryId,
      read: payload.read,
      updatedAt: new Date(),
    });
    if (updated === undefined) {
      return json({ error: "memory was not found" }, { status: 404 });
    }

    return json(
      { memoryId: updated.id, read: updated.read },
      { status: 200 },
    );
  } finally {
    connection.close();
  }
}

async function parseReadStatusPayload(
  request: Request,
): Promise<ReadStatusPayload> {
  const body = await readJsonMutationRequest(request);
  if (!body.ok) {
    return body;
  }
  const payload = body.payload;

  if (!isRecord(payload)) {
    return { ok: false, error: "request body must be an object" };
  }

  if (!hasOnlyKeys(payload, ["memoryId", "read"])) {
    return {
      ok: false,
      error: "request body must contain only memoryId and read",
    };
  }

  if (typeof payload.memoryId !== "string" || payload.memoryId.trim() === "") {
    return { ok: false, error: "memoryId must be a non-empty string" };
  }

  if (typeof payload.read !== "boolean") {
    return { ok: false, error: "read must be a boolean" };
  }

  return {
    ok: true,
    memoryId: payload.memoryId.trim(),
    read: payload.read,
  };
}

function json(body: unknown, init: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatConfigError(error: unknown): string {
  if (error instanceof TraumaConfigError) {
    console.error(error.message);
  }

  return "failed to load Trauma configuration";
}
