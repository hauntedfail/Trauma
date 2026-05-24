import type { APIEvent } from "@solidjs/start/server";

import { formatConfigError, jsonResponse } from "../http/json";
import {
  CodexAppServerClient,
  CodexAppServerError,
  type CodexModelCatalog,
} from "../translation/codex-app-server";
import {
  isCodexReasoningEffort,
  type CodexReasoningEffort,
  type TranslationErrorCode,
} from "../translation/types";
import {
  updateCodexTranslationDefaults,
  type SettingsState,
} from "./settings";

type ListCodexModels = () => Promise<CodexModelCatalog>;
type UpdateDefaults = (input: {
  model: string | null;
  reasoningEffort: CodexReasoningEffort | null;
}) => Promise<SettingsState>;

type DefaultsPayload =
  | {
      ok: true;
      model: string | null;
      reasoningEffort: CodexReasoningEffort | null;
    }
  | { ok: false; error: string };

class CodexModelSelectionError extends Error {
  constructor(
    public readonly code: Extract<
      TranslationErrorCode,
      "translation_model_unavailable" | "translation_reasoning_effort_unavailable"
    >,
    message: string,
  ) {
    super(message);
    this.name = "CodexModelSelectionError";
  }
}

export function createReadCodexModelsHandler(input: {
  listModels?: ListCodexModels;
} = {}) {
  const listModels = input.listModels ?? (() => new CodexAppServerClient().listModels());
  return async function readCodexModels(_event: APIEvent): Promise<Response> {
    try {
      return jsonResponse(await listModels(), { status: 200 });
    } catch (error) {
      return formatCodexModelError(error);
    }
  };
}

export function createUpdateCodexTranslationDefaultsHandler(input: {
  listModels?: ListCodexModels;
  updateDefaults?: UpdateDefaults;
} = {}) {
  const listModels = input.listModels ?? (() => new CodexAppServerClient().listModels());
  const updateDefaults = input.updateDefaults ??
    ((defaults) => updateCodexTranslationDefaults(defaults));

  return async function updateDefaultsRoute(event: APIEvent): Promise<Response> {
    const payload = await parseDefaultsPayload(event.request);
    if (!payload.ok) {
      return jsonResponse({ error: payload.error }, { status: 400 });
    }

    try {
      const selection = validateCodexSelection(
        await listModels(),
        payload.model,
        payload.reasoningEffort,
      );
      return jsonResponse(await updateDefaults(selection), { status: 200 });
    } catch (error) {
      return formatCodexModelError(error);
    }
  };
}

async function parseDefaultsPayload(request: Request): Promise<DefaultsPayload> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return { ok: false, error: "request body must be JSON" };
  }
  if (!isRecord(payload)) {
    return { ok: false, error: "request body must be an object" };
  }
  if (!hasOnlyAllowedKeys(payload, ["model", "reasoning_effort"])) {
    return {
      ok: false,
      error: "request body must contain only model and reasoning_effort",
    };
  }

  const model = readOptionalString(payload.model);
  if (model === undefined) {
    return { ok: false, error: "model must be a string or null" };
  }
  const effortValue = readOptionalString(payload.reasoning_effort);
  if (effortValue === undefined) {
    return { ok: false, error: "reasoning_effort must be a string or null" };
  }
  if (effortValue !== null && !isCodexReasoningEffort(effortValue)) {
    return {
      ok: false,
      error: "reasoning_effort must be a supported Codex reasoning effort",
    };
  }

  return { ok: true, model, reasoningEffort: effortValue };
}

function validateCodexSelection(
  catalog: CodexModelCatalog,
  requestedModel: string | null,
  reasoningEffort: CodexReasoningEffort | null,
) {
  const selectedModel = requestedModel === null
    ? null
    : catalog.models.find((model) =>
      model.id === requestedModel || model.model === requestedModel
    );
  if (requestedModel !== null && selectedModel === undefined) {
    throw new CodexModelSelectionError(
      "translation_model_unavailable",
      `Codex model "${requestedModel}" is unavailable.`,
    );
  }

  const modelForEffort = selectedModel ??
    catalog.models.find((model) => model.isDefault) ??
    null;
  if (
    reasoningEffort !== null &&
    (
      modelForEffort === null ||
      !modelForEffort.supportedReasoningEfforts.includes(reasoningEffort)
    )
  ) {
    throw new CodexModelSelectionError(
      "translation_reasoning_effort_unavailable",
      `Codex reasoning effort "${reasoningEffort}" is unavailable for the selected model.`,
    );
  }

  return {
    model: selectedModel?.model ?? requestedModel,
    reasoningEffort,
  };
}

function formatCodexModelError(error: unknown): Response {
  if (error instanceof CodexModelSelectionError) {
    return jsonResponse(
      {
        code: error.code,
        message: error.message,
        status: "error",
      },
      { status: 409 },
    );
  }
  if (error instanceof CodexAppServerError) {
    return jsonResponse(
      {
        code: error.code,
        message: error.message,
        status: "error",
      },
      { status: statusForCodexAppServerError(error.code) },
    );
  }
  return jsonResponse({ error: formatConfigError(error) }, { status: 500 });
}

function statusForCodexAppServerError(code: CodexAppServerError["code"]): number {
  switch (code) {
    case "app_server_unavailable":
      return 503;
    case "app_server_protocol_error":
      return 502;
    case "auth_required":
    case "setup_required":
      return 409;
    default:
      return 500;
  }
}

function readOptionalString(value: unknown): string | null | undefined {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function hasOnlyAllowedKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
