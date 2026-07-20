import type { APIEvent } from "@solidjs/start/server";

import { loadRuntimeTraumaConfig, TraumaConfigError } from "~/server/config";
import { initializeDatabase, MemoryRepositoryError } from "~/server/db";
import { readJsonMutationRequest } from "~/server/http/mutation-request";
import { generateTaxonomyId } from "~/server/taxonomy/id";

type AttachCategoryPayload =
  | { ok: true; memoryId: string; categoryId: string; name?: never }
  | { ok: true; memoryId: string; categoryId?: never; name: string }
  | { ok: false; error: string; status?: number };

export async function POST(event: APIEvent): Promise<Response> {
  const payload = await parseAttachCategoryPayload(event.request);
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
    const memory = await connection.repositories.memories.findById(
      payload.memoryId,
    );
    if (memory === undefined) {
      return json({ error: "memory was not found" }, { status: 404 });
    }

    if (payload.categoryId !== undefined) {
      try {
        await connection.repositories.taxonomy.attachCategoryToMemory({
          memoryId: payload.memoryId,
          categoryId: payload.categoryId,
          now: new Date(),
        });
      } catch (error) {
        return formatAttachError(error, "category");
      }
      return json(
        { memoryId: payload.memoryId, categoryId: payload.categoryId },
        { status: 200 },
      );
    }

    let category;
    try {
      category = await connection.repositories.taxonomy.createAndAttachCategoryToMemory(
        {
          id: generateTaxonomyId(),
          memoryId: payload.memoryId,
          name: payload.name,
          now: new Date(),
        },
      );
    } catch (error) {
      return formatAttachError(error, "category");
    }

    return json(
      { memoryId: payload.memoryId, categoryId: category.id, category },
      { status: 200 },
    );
  } finally {
    connection.close();
  }
}

async function parseAttachCategoryPayload(
  request: Request,
): Promise<AttachCategoryPayload> {
  const body = await readJsonMutationRequest(request);
  if (!body.ok) {
    return body;
  }
  const payload = body.payload;

  if (!isRecord(payload)) {
    return { ok: false, error: "request body must be an object" };
  }

  if (typeof payload.memoryId !== "string" || payload.memoryId.trim() === "") {
    return { ok: false, error: "memoryId must be a non-empty string" };
  }

  const hasCategoryId = Object.hasOwn(payload, "categoryId");
  const hasName = Object.hasOwn(payload, "name");
  if (
    !hasOnlyKeys(
      payload,
      hasCategoryId ? ["memoryId", "categoryId"] : ["memoryId", "name"],
    ) ||
    hasCategoryId === hasName
  ) {
    return {
      ok: false,
      error:
        "request body must contain memoryId and exactly one of categoryId or name",
    };
  }

  if (hasCategoryId) {
    if (
      typeof payload.categoryId !== "string" ||
      payload.categoryId.trim() === ""
    ) {
      return { ok: false, error: "categoryId must be a non-empty string" };
    }
    return {
      ok: true,
      memoryId: payload.memoryId.trim(),
      categoryId: payload.categoryId.trim(),
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

function formatAttachError(
  error: unknown,
  type: "category",
): Response {
  if (error instanceof MemoryRepositoryError) {
    if (error.message.includes("missing memory")) {
      return json({ error: "memory was not found" }, { status: 404 });
    }
    if (error.message.includes(`missing ${type}`)) {
      return json({ error: `${type} was not found` }, { status: 404 });
    }
  }
  return json({ error: "failed to attach category" }, { status: 500 });
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
