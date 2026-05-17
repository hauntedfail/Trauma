import type { APIEvent } from "@solidjs/start/server";

import { loadRuntimeTraumaConfig, TraumaConfigError } from "~/server/config";
import { initializeDatabase, MemoryRepositoryError } from "~/server/db";
import { generateTaxonomyId } from "~/server/taxonomy/id";

type AttachTagPayload =
  | { ok: true; memoryId: string; tagId: string; name?: never }
  | { ok: true; memoryId: string; tagId?: never; name: string }
  | { ok: false; error: string };

export async function POST(event: APIEvent): Promise<Response> {
  const payload = await parseAttachTagPayload(event.request);
  if (!payload.ok) {
    return json({ error: payload.error }, { status: 400 });
  }

  let config;
  try {
    config = loadRuntimeTraumaConfig();
  } catch (error) {
    return json({ error: formatConfigError(error) }, { status: 500 });
  }

  const connection = initializeDatabase(config);
  try {
    const memory = await connection.repositories.memories.findById(
      payload.memoryId,
    );
    if (memory === undefined) {
      return json({ error: "memory was not found" }, { status: 404 });
    }

    if (payload.tagId !== undefined) {
      try {
        await connection.repositories.taxonomy.attachTagToMemory({
          memoryId: payload.memoryId,
          tagId: payload.tagId,
          now: new Date(),
        });
      } catch (error) {
        return formatAttachError(error, "tag");
      }
      return json(
        { memoryId: payload.memoryId, tagId: payload.tagId },
        { status: 200 },
      );
    }

    let tag;
    try {
      tag = await connection.repositories.taxonomy.createAndAttachTagToMemory({
        id: generateTaxonomyId(),
        memoryId: payload.memoryId,
        name: payload.name,
        now: new Date(),
      });
    } catch (error) {
      return formatAttachError(error, "tag");
    }

    return json(
      { memoryId: payload.memoryId, tagId: tag.id, tag },
      { status: 200 },
    );
  } finally {
    connection.close();
  }
}

async function parseAttachTagPayload(
  request: Request,
): Promise<AttachTagPayload> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return { ok: false, error: "request body must be JSON" };
  }

  if (!isRecord(payload)) {
    return { ok: false, error: "request body must be an object" };
  }

  if (typeof payload.memoryId !== "string" || payload.memoryId.trim() === "") {
    return { ok: false, error: "memoryId must be a non-empty string" };
  }

  const hasTagId = Object.hasOwn(payload, "tagId");
  const hasName = Object.hasOwn(payload, "name");
  if (
    !hasOnlyKeys(payload, hasTagId ? ["memoryId", "tagId"] : ["memoryId", "name"]) ||
    hasTagId === hasName
  ) {
    return {
      ok: false,
      error: "request body must contain memoryId and exactly one of tagId or name",
    };
  }

  if (hasTagId) {
    if (typeof payload.tagId !== "string" || payload.tagId.trim() === "") {
      return { ok: false, error: "tagId must be a non-empty string" };
    }
    return {
      ok: true,
      memoryId: payload.memoryId.trim(),
      tagId: payload.tagId.trim(),
    };
  }

  if (typeof payload.name !== "string") {
    return { ok: false, error: "name must be a non-empty string" };
  }

  const name = payload.name.trim();
  if (name === "") {
    return { ok: false, error: "name must be a non-empty string" };
  }

  return {
    ok: true,
    memoryId: payload.memoryId.trim(),
    name,
  };
}

function formatAttachError(error: unknown, type: "tag"): Response {
  if (error instanceof MemoryRepositoryError) {
    if (error.message.includes("missing memory")) {
      return json({ error: "memory was not found" }, { status: 404 });
    }
    if (error.message.includes(`missing ${type}`)) {
      return json({ error: `${type} was not found` }, { status: 404 });
    }
  }
  return json({ error: "failed to attach tag" }, { status: 500 });
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
