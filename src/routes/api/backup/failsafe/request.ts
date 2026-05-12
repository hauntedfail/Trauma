import { TraumaConfigError } from "~/server/config";

export async function readConfirmedJsonRequest(request: Request) {
  if (!isSameOriginRequest(request)) {
    return {
      ok: false as const,
      response: json(
        { error: "same-origin request is required" },
        { status: 403 },
      ),
    };
  }

  if (!isJsonContentType(request.headers.get("content-type"))) {
    return {
      ok: false as const,
      response: json(
        { error: "content-type must be application/json" },
        { status: 415 },
      ),
    };
  }

  try {
    const payload = await request.json();
    if (isRecord(payload) && payload.confirm === true) {
      return { ok: true as const };
    }
  } catch {
    // Invalid JSON is handled as missing confirmation.
  }

  return {
    ok: false as const,
    response: json({ error: "confirmation is required" }, { status: 400 }),
  };
}

export function json(body: unknown, init: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

export function formatConfigError(error: unknown) {
  if (error instanceof TraumaConfigError) {
    console.error(error.message);
  }
  return "failed to load Trauma configuration";
}

function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (origin === null) {
    return true;
  }

  return origin === new URL(request.url).origin;
}

function isJsonContentType(contentType: string | null) {
  return contentType?.toLowerCase().split(";")[0]?.trim() === "application/json";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
