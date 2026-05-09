import { createNoopMemoryBackupQueue } from "~/server/backup";
import { loadTraumaConfig, TraumaConfigError } from "~/server/config";
import { initializeDatabase } from "~/server/db";
import { validateImportUrl } from "~/server/importer";
import { addMemory } from "~/server/memories/add-memory";

interface ApiRouteEvent {
  request: Request;
}

export async function POST(event: ApiRouteEvent): Promise<Response> {
  const payload = await parseAddMemoryPayload(event.request);
  if (!payload.ok) {
    return json({ error: payload.error }, { status: 400 });
  }

  let config;
  try {
    config = loadTraumaConfig();
  } catch (error) {
    return json({ error: formatConfigError(error) }, { status: 500 });
  }

  const connection = initializeDatabase(config);
  try {
    const memory = await addMemory({
      url: payload.url,
      config,
      db: connection.db,
      backupQueue: createNoopMemoryBackupQueue(),
    });

    return json({ memory }, { status: 201 });
  } finally {
    connection.close();
  }
}

type AddMemoryPayloadResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

async function parseAddMemoryPayload(
  request: Request,
): Promise<AddMemoryPayloadResult> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return { ok: false, error: "request body must be JSON" };
  }

  if (!isRecord(payload)) {
    return { ok: false, error: "request body must be an object" };
  }

  const keys = Object.keys(payload);
  if (keys.length !== 1 || keys[0] !== "url") {
    return { ok: false, error: "request body must contain only url" };
  }

  if (typeof payload.url !== "string" || payload.url.trim() === "") {
    return { ok: false, error: "url must be a non-empty string" };
  }

  try {
    return { ok: true, url: await validateImportUrl(payload.url) };
  } catch {
    return { ok: false, error: "url must be a valid absolute URL" };
  }
}

function json(body: unknown, init: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatConfigError(error: unknown) {
  if (error instanceof TraumaConfigError) {
    return error.message;
  }

  return "failed to load Trauma configuration";
}
