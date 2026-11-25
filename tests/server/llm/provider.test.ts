import { afterEach, describe, expect, it } from "vitest";

import { OpenAICompatibleClient } from "../../../src/server/llm/openai-compatible-client";
import {
  createLlmAuthClient,
  createLlmConversationClient,
  createLlmModelsClient,
  createLlmTranslationClient,
  isOpenAICompatibleProviderEnabled,
  resolveLlmProviderKind,
} from "../../../src/server/llm/provider";
import { isPsychiatristRuntimeIsolationReady } from "../../../src/server/psychiatrist/runtime-isolation";
import { readCodexAuthStatus } from "../../../src/server/settings/codex-auth";
import { createReadCodexModelsHandler } from "../../../src/server/settings/codex-model-routes";
import {
  CodexAppServerClient,
  CodexAppServerError,
} from "../../../src/server/translation/codex-app-server";

const originalEnv = {
  TRAUMA_LLM_PROVIDER: process.env.TRAUMA_LLM_PROVIDER,
  TRAUMA_OPENAI_BASE_URL: process.env.TRAUMA_OPENAI_BASE_URL,
  TRAUMA_OPENAI_API_KEY: process.env.TRAUMA_OPENAI_API_KEY,
  TRAUMA_OPENAI_DEFAULT_MODEL: process.env.TRAUMA_OPENAI_DEFAULT_MODEL,
};
const originalFetch = globalThis.fetch;

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  globalThis.fetch = originalFetch;
});

describe("LLM provider factory and fallback", () => {
  it("defaults to codex fallback when TRAUMA_LLM_PROVIDER is unset or codex", () => {
    expect(resolveLlmProviderKind({})).toBe("codex");
    expect(resolveLlmProviderKind({ TRAUMA_LLM_PROVIDER: "codex" })).toBe("codex");
    expect(isOpenAICompatibleProviderEnabled({})).toBe(false);

    expect(createLlmTranslationClient({ environment: {} })).toBeInstanceOf(
      CodexAppServerClient,
    );
    expect(
      createLlmConversationClient({
        environment: { TRAUMA_LLM_PROVIDER: "codex" },
      }),
    ).toBeInstanceOf(CodexAppServerClient);
    expect(createLlmModelsClient({ environment: {} })).toBeInstanceOf(
      CodexAppServerClient,
    );
    expect(createLlmAuthClient({ environment: {} })).toBeInstanceOf(
      CodexAppServerClient,
    );
  });

  it("returns OpenAICompatibleClient when TRAUMA_LLM_PROVIDER=openai_compatible", () => {
    const env = {
      TRAUMA_LLM_PROVIDER: "openai_compatible",
      TRAUMA_OPENAI_BASE_URL: "https://sibyl.haunted.fail/llm/v1",
      TRAUMA_OPENAI_API_KEY: "test-key",
      TRAUMA_OPENAI_DEFAULT_MODEL: "gpt-4o-mini",
    };

    expect(resolveLlmProviderKind(env)).toBe("openai_compatible");
    expect(isOpenAICompatibleProviderEnabled(env)).toBe(true);
    expect(createLlmTranslationClient({ environment: env })).toBeInstanceOf(
      OpenAICompatibleClient,
    );
    expect(createLlmConversationClient({ environment: env })).toBeInstanceOf(
      OpenAICompatibleClient,
    );
    expect(createLlmModelsClient({ environment: env })).toBeInstanceOf(
      OpenAICompatibleClient,
    );
    expect(createLlmAuthClient({ environment: env })).toBeInstanceOf(
      OpenAICompatibleClient,
    );
  });

  it("fails closed on invalid provider or missing TRAUMA_OPENAI_BASE_URL", () => {
    expect(() =>
      resolveLlmProviderKind({ TRAUMA_LLM_PROVIDER: "unsupported" }),
    ).toThrowError(CodexAppServerError);

    expect(() =>
      createLlmConversationClient({
        environment: { TRAUMA_LLM_PROVIDER: "openai_compatible" },
      }),
    ).toThrowError(CodexAppServerError);

    try {
      createLlmConversationClient({
        environment: { TRAUMA_LLM_PROVIDER: "openai_compatible" },
      });
    } catch (error) {
      expect((error as CodexAppServerError).code).toBe("setup_required");
    }
  });

  it("skips Codex runtime isolation gate only when openai_compatible mode is active", () => {
    expect(
      isPsychiatristRuntimeIsolationReady({
        environment: { TRAUMA_LLM_PROVIDER: "openai_compatible" },
        hasInjectedClient: false,
      }),
    ).toBe(true);

    expect(
      isPsychiatristRuntimeIsolationReady({
        environment: { TRAUMA_LLM_PROVIDER: "codex" },
        hasInjectedClient: false,
      }),
    ).toBe(false);

    expect(
      isPsychiatristRuntimeIsolationReady({
        environment: {},
        hasInjectedClient: false,
      }),
    ).toBe(false);
  });

  it("reports connected status and model catalog cleanly through settings routes in openai_compatible mode", async () => {
    process.env.TRAUMA_LLM_PROVIDER = "openai_compatible";
    process.env.TRAUMA_OPENAI_BASE_URL = "http://127.0.0.1:3425/v1";
    process.env.TRAUMA_OPENAI_DEFAULT_MODEL = "magpie-1";

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [{ id: "magpie-1", owned_by: "magpie" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch;

    const authStatus = await readCodexAuthStatus();
    expect(authStatus).toEqual({
      status: "enabled",
      provider: "codex",
      message: "OpenAI-compatible LLM provider is connected.",
    });

    const getModels = createReadCodexModelsHandler();
    const response = await getModels({} as never);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      models: Array<{ id: string; isDefault: boolean }>;
    };
    expect(body.models).toHaveLength(1);
    expect(body.models[0]).toMatchObject({
      id: "magpie-1",
      isDefault: true,
    });
  });

  it("returns setup_required from readCodexAuthStatus when TRAUMA_OPENAI_BASE_URL is missing", async () => {
    process.env.TRAUMA_LLM_PROVIDER = "openai_compatible";
    delete process.env.TRAUMA_OPENAI_BASE_URL;

    const authStatus = await readCodexAuthStatus();
    expect(authStatus).toMatchObject({
      status: "setup_required",
      reason: "openai_compatible_setup_required",
    });
  });
});
