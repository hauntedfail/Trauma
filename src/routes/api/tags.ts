import type { APIEvent } from "@solidjs/start/server";

import { loadRuntimeTraumaConfig, TraumaConfigError } from "~/server/config";
import { initializeDatabase } from "~/server/db";
import { readJsonMutationRequest } from "~/server/http/mutation-request";
import { generateTaxonomyId } from "~/server/taxonomy/id";
import { validateTagName } from "~/taxonomy/name-policy";

export async function POST(event: APIEvent): Promise<Response> {
  const payload = await parseNamePayloadInternal(event.request);
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
    const existing = await connection.repositories.taxonomy.findTagByName(
      payload.name,
    );
    if (existing !== undefined) {
      return json({ tag: existing }, { status: 200 });
    }

    const tag = await connection.repositories.taxonomy.createTag({
      id: generateTaxonomyId(),
      name: payload.name,
      now: new Date(),
    });
    return json({ tag }, { status: 201 });
  } finally {
    connection.close();
  }
}

type NamePayload =
  | { ok: true; name: string }
  | { ok: false; error: string; status?: number };

export const parseNamePayload = parseNamePayloadInternal;

async function parseNamePayloadInternal(request: Request): Promise<NamePayload> {
  const body = await readJsonMutationRequest(request);
  if (!body.ok) {
    return body;
  }
  const payload = body.payload;

  if (!isRecord(payload)) {
    return { ok: false, error: "request body must be an object" };
  }

  if (!hasOnlyKeys(payload, ["name"])) {
    return { ok: false, error: "request body must contain only name" };
  }

  if (typeof payload.name !== "string") {
    return { ok: false, error: "name must be a non-empty string" };
  }

  const name = payload.name.trim();
  const validation = validateTagName(name);
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  return { ok: true, name: validation.name };
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
