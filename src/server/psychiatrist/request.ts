import { readJsonMutationRequest } from "../http/mutation-request";
import type { PsychiatristThreadManifest } from "./types";

export const MAX_PSYCHIATRIST_JSON_BODY_BYTES = 16_384;

export interface PsychiatristRequestScope {
  langCode?: string;
  memoryId: string;
  threadId: string;
  variantKind?: "source" | "translation";
}

export type PsychiatristVariantScope = Pick<
  PsychiatristRequestScope,
  "langCode" | "variantKind"
>;

export type PsychiatristJsonBodyResult =
  | { ok: true; payload: unknown }
  | { ok: false; message: string; status: number };

export async function readPsychiatristJsonBody(
  request: Request,
  input: { allowEmpty?: boolean } = {},
): Promise<PsychiatristJsonBodyResult> {
  const body = await readJsonMutationRequest(request, {
    allowEmpty: input.allowEmpty,
    contentTypePolicy: "always",
    maxBytes: MAX_PSYCHIATRIST_JSON_BODY_BYTES,
  });
  if (!body.ok) {
    return {
      ok: false,
      message: `${body.error}.`,
      status: body.status,
    };
  }
  return body;
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
  const variantKind = readOptionalNullableString(payload, "variant_kind");
  if (
    variantKind === "invalid" ||
    variantKind !== undefined &&
    variantKind !== "source" &&
    variantKind !== "translation"
  ) {
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
      ...(variantKind === undefined ? {} : { variantKind }),
    },
  };
}

export function readOptionalPsychiatristLangCode(
  payload: Record<string, unknown>,
): { ok: true; langCode?: string } | { ok: false; message: string } {
  const langCode = readOptionalNullableString(payload, "lang_code");
  if (langCode === "invalid") {
    return { ok: false, message: "lang_code must be a non-empty string or null." };
  }
  return {
    ok: true,
    ...(langCode === undefined ? {} : { langCode }),
  };
}

export function readOptionalPsychiatristVariantKind(
  payload: Record<string, unknown>,
): { ok: true; variantKind?: "source" | "translation" } | { ok: false; message: string } {
  const variantKind = readOptionalNullableString(payload, "variant_kind");
  if (
    variantKind === "invalid" ||
    variantKind !== undefined && variantKind !== "source" && variantKind !== "translation"
  ) {
    return { ok: false, message: "variant_kind must be source or translation." };
  }
  return {
    ok: true,
    ...(variantKind === undefined ? {} : { variantKind }),
  };
}

export function matchesPsychiatristVariantScope(
  scope: PsychiatristVariantScope,
  manifest: Pick<PsychiatristThreadManifest, "langCode" | "variantKind">,
): boolean {
  const variantKind = scope.variantKind ??
    (scope.langCode === undefined ? "source" : "translation");
  return variantKind === manifest.variantKind && scope.langCode === manifest.langCode;
}

export function psychiatristTurnEventsUrl(input: {
  langCode?: string;
  memoryId: string;
  threadId: string;
  turnId: string;
  variantKind: "source" | "translation";
}): string {
  const query = new URLSearchParams({ variant_kind: input.variantKind });
  if (input.langCode !== undefined) {
    query.set("lang_code", input.langCode);
  }
  return `/api/memories/${encodeURIComponent(input.memoryId)}` +
    `/psychiatrist/threads/${encodeURIComponent(input.threadId)}` +
    `/turns/${encodeURIComponent(input.turnId)}/events?${query.toString()}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
