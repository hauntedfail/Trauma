export const MAX_PSYCHIATRIST_JSON_BODY_BYTES = 16_384;

export interface PsychiatristRequestScope {
  langCode?: string;
  memoryId: string;
  threadId: string;
  variantKind: "source" | "translation";
}

export type PsychiatristJsonBodyResult =
  | { ok: true; payload: unknown }
  | { ok: false; message: string; status: number };

export async function readPsychiatristJsonBody(
  request: Request,
  input: { allowEmpty?: boolean } = {},
): Promise<PsychiatristJsonBodyResult> {
  if (!isSameOriginRequest(request)) {
    return {
      ok: false,
      message: "same-origin request is required.",
      status: 403,
    };
  }

  const contentType = request.headers.get("content-type");
  if (contentType !== null && !isJsonContentType(contentType)) {
    return {
      ok: false,
      message: "content-type must be application/json.",
      status: 415,
    };
  }
  if (request.body === null) {
    if (input.allowEmpty === true) {
      return { ok: true, payload: undefined };
    }
    if (contentType !== null) {
      return { ok: false, message: "request body must be JSON.", status: 400 };
    }
    return {
      ok: false,
      message: "content-type must be application/json.",
      status: 415,
    };
  }
  if (contentType === null) {
    return {
      ok: false,
      message: "content-type must be application/json.",
      status: 415,
    };
  }
  const body = await readRequestTextWithLimit(request);
  if (!body.ok) {
    return body;
  }
  const rawBody = body.text;
  if (rawBody.trim() === "" && input.allowEmpty === true) {
    return { ok: true, payload: undefined };
  }

  try {
    return { ok: true, payload: JSON.parse(rawBody) as unknown };
  } catch {
    return { ok: false, message: "request body must be JSON.", status: 400 };
  }
}

export function readPsychiatristRequestScope(
  payload: Record<string, unknown>,
): { ok: true; scope: PsychiatristRequestScope } | { ok: false; message: string } {
  const memoryId = readRequiredString(payload, "memory_id");
  if (memoryId === undefined) {
    return { ok: false, message: "memory_id must be a non-empty string." };
  }
  const threadId = readRequiredString(payload, "thread_id");
  if (threadId === undefined) {
    return { ok: false, message: "thread_id must be a non-empty string." };
  }
  const variantKind = readRequiredString(payload, "variant_kind");
  if (variantKind !== "source" && variantKind !== "translation") {
    return { ok: false, message: "variant_kind must be source or translation." };
  }
  const langCode = readOptionalNullableString(payload, "lang_code");
  if (langCode === "invalid") {
    return { ok: false, message: "lang_code must be a non-empty string or null." };
  }
  return {
    ok: true,
    scope: {
      ...(langCode === undefined ? {} : { langCode }),
      memoryId,
      threadId,
      variantKind,
    },
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) {
    return true;
  }
  return origin === new URL(request.url).origin;
}

function isJsonContentType(contentType: string): boolean {
  return contentType.toLowerCase().split(";")[0]?.trim() === "application/json";
}

async function readRequestTextWithLimit(
  request: Request,
): Promise<{ ok: true; text: string } | { ok: false; message: string; status: number }> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_PSYCHIATRIST_JSON_BODY_BYTES) {
      return {
        ok: false,
        message: "request body is too large.",
        status: 413,
      };
    }
  }

  const reader = request.body?.getReader();
  if (reader === undefined) {
    return { ok: true, text: "" };
  }
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done === true) {
      break;
    }
    byteLength += chunk.value.byteLength;
    if (byteLength > MAX_PSYCHIATRIST_JSON_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return {
        ok: false,
        message: "request body is too large.",
        status: 413,
      };
    }
    text += decoder.decode(chunk.value, { stream: true });
    if (text.length > MAX_PSYCHIATRIST_JSON_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return {
        ok: false,
        message: "request body is too large.",
        status: 413,
      };
    }
  }
  text += decoder.decode();
  return { ok: true, text };
}

function readRequiredString(
  payload: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

function readOptionalNullableString(
  payload: Record<string, unknown>,
  key: string,
): string | undefined | "invalid" {
  if (!Object.hasOwn(payload, key) || payload[key] === null || payload[key] === undefined) {
    return undefined;
  }
  const value = payload[key];
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : "invalid";
}
