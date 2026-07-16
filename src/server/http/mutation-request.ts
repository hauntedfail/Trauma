export const MAX_MUTATION_JSON_BODY_BYTES = 1_048_576;

export type MutationRequestFailure = {
  ok: false;
  error: string;
  status: 400 | 403 | 413 | 415;
};

export type MutationRequestGuard =
  | { ok: true; browser: boolean }
  | MutationRequestFailure;

export type JsonMutationRequestResult =
  | { ok: true; payload: unknown }
  | MutationRequestFailure;

interface ReadJsonMutationRequestOptions {
  allowEmpty?: boolean;
  contentTypePolicy?: "always" | "browser";
  maxBytes?: number;
}

export function guardMutationRequest(request: Request): MutationRequestGuard {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();

  if (origin !== null) {
    if (
      origin !== new URL(request.url).origin ||
      fetchSite !== undefined && fetchSite !== "same-origin" && fetchSite !== "none"
    ) {
      return sameOriginFailure();
    }
    return { ok: true, browser: true };
  }

  if (fetchSite !== undefined) {
    if (fetchSite !== "same-origin" && fetchSite !== "none") {
      return sameOriginFailure();
    }
    return { ok: true, browser: true };
  }

  return { ok: true, browser: false };
}

export async function readJsonMutationRequest(
  request: Request,
  options: ReadJsonMutationRequestOptions = {},
): Promise<JsonMutationRequestResult> {
  const guard = guardMutationRequest(request);
  if (!guard.ok) {
    return guard;
  }

  const maxBytes = options.maxBytes ?? MAX_MUTATION_JSON_BODY_BYTES;
  if (declaredBodyExceedsLimit(request, maxBytes)) {
    return bodyTooLargeFailure();
  }

  const contentTypePolicy = options.contentTypePolicy ?? "browser";
  if (request.body === null) {
    const contentType = request.headers.get("content-type");
    if (
      contentTypePolicy === "always" &&
      (options.allowEmpty !== true || contentType !== null) &&
      !isJsonContentType(contentType)
    ) {
      return invalidContentTypeFailure();
    }
    return options.allowEmpty === true
      ? { ok: true, payload: undefined }
      : invalidJsonFailure();
  }

  if (
    (contentTypePolicy === "always" || guard.browser) &&
    !isJsonContentType(request.headers.get("content-type"))
  ) {
    return invalidContentTypeFailure();
  }

  const body = await readRequestTextWithLimit(
    request,
    maxBytes,
  );
  if (!body.ok) {
    return body;
  }
  if (body.text.trim() === "" && options.allowEmpty === true) {
    return { ok: true, payload: undefined };
  }

  try {
    return { ok: true, payload: JSON.parse(body.text) as unknown };
  } catch {
    return invalidJsonFailure();
  }
}

function sameOriginFailure(): MutationRequestFailure {
  return {
    ok: false,
    error: "same-origin request is required",
    status: 403,
  };
}

function invalidJsonFailure(): MutationRequestFailure {
  return {
    ok: false,
    error: "request body must be JSON",
    status: 400,
  };
}

function invalidContentTypeFailure(): MutationRequestFailure {
  return {
    ok: false,
    error: "content-type must be application/json",
    status: 415,
  };
}

function isJsonContentType(contentType: string | null): boolean {
  return contentType?.toLowerCase().split(";")[0]?.trim() === "application/json";
}

function declaredBodyExceedsLimit(request: Request, maxBytes: number): boolean {
  const contentLength = request.headers.get("content-length");
  if (contentLength === null) {
    return false;
  }

  const declaredLength = Number(contentLength);
  return Number.isFinite(declaredLength) && declaredLength > maxBytes;
}

async function readRequestTextWithLimit(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | MutationRequestFailure> {
  const reader = request.body?.getReader();
  if (reader === undefined) {
    return { ok: true, text: "" };
  }

  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    byteLength += chunk.value.byteLength;
    if (byteLength > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return bodyTooLargeFailure();
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  text += decoder.decode();
  return { ok: true, text };
}

function bodyTooLargeFailure(): MutationRequestFailure {
  return {
    ok: false,
    error: "request body is too large",
    status: 413,
  };
}
