import type { APIEvent } from "@solidjs/start/server";

import { getMemoryBackupQueue } from "~/server/backup";
import {
  BrowserImportError,
  importBrowserCapture,
  isBrowserImportOriginAllowed,
  loadBrowserImportConfig,
  parseBrowserImportPayload,
  verifyBrowserImportAuthorization,
} from "~/server/browser-import";
import { loadRuntimeTraumaConfig, TraumaConfigError } from "~/server/config";
import { initializeDatabase } from "~/server/db";

export async function OPTIONS(event: APIEvent): Promise<Response> {
  const config = loadBrowserImportConfig();
  const origin = event.request.headers.get("origin");
  if (!config.enabled || !isBrowserImportOriginAllowed(origin, config)) {
    return new Response(null, { status: 204 });
  }

  return new Response(null, {
    status: 204,
    headers: createCorsHeaders(origin),
  });
}

export async function POST(event: APIEvent): Promise<Response> {
  const browserImportConfig = loadBrowserImportConfig();
  const origin = event.request.headers.get("origin");
  const corsHeaders = isBrowserImportOriginAllowed(origin, browserImportConfig)
    ? createCorsHeaders(origin)
    : {};

  if (!browserImportConfig.enabled) {
    return json(
      { error: "browser import is disabled" },
      { status: 403, headers: corsHeaders },
    );
  }

  if (!isBrowserImportOriginAllowed(origin, browserImportConfig)) {
    return json(
      { error: "browser import origin is not allowed" },
      { status: 403 },
    );
  }

  if (
    !verifyBrowserImportAuthorization(
      event.request.headers.get("authorization"),
      browserImportConfig.token,
    )
  ) {
    return json(
      { error: "browser import token is invalid" },
      { status: 401, headers: corsHeaders },
    );
  }

  if (!isJsonContentType(event.request.headers.get("content-type"))) {
    return json(
      { error: "content-type must be application/json" },
      { status: 415, headers: corsHeaders },
    );
  }

  const contentLength = event.request.headers.get("content-length");
  if (contentLength !== null && Number.parseInt(contentLength, 10) > browserImportConfig.maxBytes) {
    return json(
      { error: "request body is too large" },
      { status: 413, headers: corsHeaders },
    );
  }

  const parsed = parseBrowserImportPayload(await event.request.text(), {
    maxBytes: browserImportConfig.maxBytes,
  });
  if (!parsed.ok) {
    return json({ error: parsed.error }, { status: 400, headers: corsHeaders });
  }

  let traumaConfig;
  try {
    traumaConfig = loadRuntimeTraumaConfig();
  } catch (error) {
    return json(
      { error: formatConfigError(error) },
      { status: 500, headers: corsHeaders },
    );
  }

  const connection = initializeDatabase(traumaConfig);
  try {
    const memory = await importBrowserCapture({
      payload: parsed.payload,
      config: traumaConfig,
      db: connection.db,
      backupQueue: getMemoryBackupQueue(traumaConfig),
    });

    return json(
      { memory, url: `/memories/${memory.id}` },
      { status: 201, headers: corsHeaders },
    );
  } catch (error) {
    if (error instanceof BrowserImportError) {
      return json(
        { error: error.message },
        { status: error.status, headers: corsHeaders },
      );
    }

    throw error;
  } finally {
    connection.close();
  }
}

function createCorsHeaders(origin: string | null): HeadersInit {
  if (origin === null) {
    return {};
  }

  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

function isJsonContentType(contentType: string | null) {
  return contentType?.toLowerCase().split(";")[0]?.trim() === "application/json";
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

function formatConfigError(error: unknown) {
  if (error instanceof TraumaConfigError) {
    console.error(error.message);
  }

  return "failed to load Trauma configuration";
}
