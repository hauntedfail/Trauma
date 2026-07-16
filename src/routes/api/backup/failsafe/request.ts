import { TraumaConfigError } from "~/server/config";
import { readJsonMutationRequest } from "~/server/http/mutation-request";

const MAX_BACKUP_FAILSAFE_JSON_BODY_BYTES = 16_384;

export async function readConfirmedJsonRequest(request: Request) {
  const body = await readJsonMutationRequest(request, {
    contentTypePolicy: "always",
    maxBytes: MAX_BACKUP_FAILSAFE_JSON_BODY_BYTES,
  });
  if (!body.ok) {
    const error = body.status === 400
      ? "confirmation is required"
      : body.error;
    return {
      ok: false as const,
      response: json(
        { error },
        { status: body.status },
      ),
    };
  }

  if (isRecord(body.payload) && body.payload.confirm === true) {
    return { ok: true as const };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
