import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GET as readSettings } from "../../../src/routes/api/settings";
import { PATCH as updateLanguage } from "../../../src/routes/api/settings/translation-language";
import { DELETE as deleteOpenAiAuth } from "../../../src/routes/api/settings/openai-auth";
import { POST as enableOpenAiAuth } from "../../../src/routes/api/settings/openai-auth/enable";
import { MAX_MUTATION_JSON_BODY_BYTES } from "../../../src/server/http/mutation-request";
import {
  createReadCodexModelsHandler,
  createUpdateCodexTranslationDefaultsHandler,
} from "../../../src/server/settings/codex-model-routes";
import { CodexAppServerError } from "../../../src/server/translation/codex-app-server";
import {
  createApiEvent,
  loadRouteConfig,
  writeRouteConfig,
} from "./api-test-helpers";

const originalEnv = { ...process.env };
const tempDirs: string[] = [];

afterEach(async () => {
  process.env = { ...originalEnv };
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("settings API routes", () => {
  it("reads settings without exposing credential material", async () => {
    await useTempRouteConfig();

    const response = await readSettings(apiEvent("/api/settings", "GET"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      translationTargetLanguage: "ja-JP",
      codexTranslationModel: null,
      codexTranslationReasoningEffort: null,
      openaiAuth: {
        status: "setup_required",
        provider: "codex",
        reason: "codex_app_server_unavailable",
      },
    });
  });

  it("updates translation target language and rejects malformed or unsupported payloads", async () => {
    await useTempRouteConfig();

    const updated = await updateLanguage(
      jsonEvent("/api/settings/translation-language", "PATCH", {
        language: "ko-KR",
      }),
    );
    const malformed = await updateLanguage(
      jsonEvent("/api/settings/translation-language", "PATCH", {
        language: "ko-KR",
        extra: true,
      }),
    );
    const unsupported = await updateLanguage(
      jsonEvent("/api/settings/translation-language", "PATCH", {
        language: "xx-XX",
      }),
    );

    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      translationTargetLanguage: "ko-KR",
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({
      error: "request body must contain only language",
    });
    expect(unsupported.status).toBe(400);
    expect(await unsupported.json()).toEqual({
      error: "unsupported translation target language",
    });
  });

  it("reads the Codex model catalog through a settings-scoped route", async () => {
    const handler = createReadCodexModelsHandler({
      listModels: async () => ({
        models: [
          {
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "GPT-5.5",
            description: "Frontier model",
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: ["low", "medium", "high"],
          },
        ],
      }),
    });

    const response = await handler(apiEvent("/api/settings/codex-models", "GET"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      models: [
        {
          id: "gpt-5.5",
          model: "gpt-5.5",
          displayName: "GPT-5.5",
          description: "Frontier model",
          isDefault: true,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: ["low", "medium", "high"],
        },
      ],
    });
  });

  it("projects Codex model failures without raw diagnostics", async () => {
    const secret = "/Users/alice/.codex/auth.json token=unique-secret";
    const handler = createReadCodexModelsHandler({
      listModels: async () => {
        throw new CodexAppServerError("app_server_protocol_error", secret);
      },
    });

    const response = await handler(apiEvent("/api/settings/codex-models", "GET"));
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body).toEqual({
      code: "app_server_protocol_error",
      message: "Codex app-server returned an invalid response.",
      status: "error",
    });
    expect(JSON.stringify(body)).not.toContain(secret);
  });

  it("closes internally created Codex model clients after reading the catalog", async () => {
    let closeCalls = 0;
    const handler = createReadCodexModelsHandler({
      createClient: () => ({
        close: async () => {
          closeCalls += 1;
        },
        listModels: async () => ({ models: [] }),
      }),
    });

    const response = await handler(apiEvent("/api/settings/codex-models", "GET"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ models: [] });
    expect(closeCalls).toBe(1);
  });

  it("updates Codex translation defaults after validating the catalog", async () => {
    const updates: unknown[] = [];
    const handler = createUpdateCodexTranslationDefaultsHandler({
      readDefaults: async () => ({
        model: null,
        reasoningEffort: null,
      }),
      listModels: async () => ({
        models: [
          {
            id: "model-id",
            model: "gpt-5.5",
            displayName: "GPT-5.5",
            description: "Frontier model",
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: ["low", "medium", "high"],
          },
        ],
      }),
      updateDefaults: async (input) => {
        updates.push(input);
        return {
          translationTargetLanguage: "ja-JP",
          codexTranslationModel: input.model ?? null,
          codexTranslationReasoningEffort: input.reasoningEffort ?? null,
          openaiAuth: {
            status: "enabled",
            provider: "codex",
            message: "Codex ChatGPT sign-in is enabled.",
          },
        };
      },
    });

    const response = await handler(
      jsonEvent("/api/settings/translation-codex-defaults", "PATCH", {
        model: "model-id",
        reasoning_effort: "high",
      }),
    );

    expect(response.status).toBe(200);
    expect(updates).toEqual([{ model: "gpt-5.5", reasoningEffort: "high" }]);
    await expect(response.json()).resolves.toMatchObject({
      codexTranslationModel: "gpt-5.5",
      codexTranslationReasoningEffort: "high",
    });
  });

  it("rejects cross-origin settings mutations before dependencies run", async () => {
    let listCalls = 0;
    let readCalls = 0;
    let updateCalls = 0;
    const handler = createUpdateCodexTranslationDefaultsHandler({
      listModels: async () => {
        listCalls += 1;
        return { models: [] };
      },
      readDefaults: async () => {
        readCalls += 1;
        return { model: null, reasoningEffort: null };
      },
      updateDefaults: async () => {
        updateCalls += 1;
        throw new Error("must not update cross-origin settings");
      },
    });

    const response = await handler(
      createApiEvent(
        new Request("http://localhost/api/settings/translation-codex-defaults", {
          method: "PATCH",
          headers: {
            "content-type": "text/plain",
            origin: "https://evil.example",
          },
          body: JSON.stringify({ reasoning_effort: "high" }),
        }),
      ),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "same-origin request is required",
    });
    expect({ listCalls, readCalls, updateCalls }).toEqual({
      listCalls: 0,
      readCalls: 0,
      updateCalls: 0,
    });
  });

  it("rejects oversized settings mutations before dependencies run", async () => {
    let listCalls = 0;
    let updateCalls = 0;
    const handler = createUpdateCodexTranslationDefaultsHandler({
      listModels: async () => {
        listCalls += 1;
        return { models: [] };
      },
      updateDefaults: async () => {
        updateCalls += 1;
        throw new Error("must not update oversized settings");
      },
    });

    const response = await handler(
      createApiEvent(
        new Request("http://localhost/api/settings/translation-codex-defaults", {
          method: "PATCH",
          headers: {
            "content-length": String(MAX_MUTATION_JSON_BODY_BYTES + 1),
            "content-type": "application/json",
            origin: "http://localhost",
          },
          body: "{}",
        }),
      ),
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: "request body is too large",
    });
    expect({ listCalls, updateCalls }).toEqual({
      listCalls: 0,
      updateCalls: 0,
    });
  });

  it("persists normalized Codex translation defaults through the settings route", async () => {
    await useTempRouteConfig();
    const handler = createUpdateCodexTranslationDefaultsHandler({
      listModels: async () => ({
        models: [
          {
            id: "model-id",
            model: "gpt-5.5",
            displayName: "GPT-5.5",
            description: "Frontier model",
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: ["low", "medium", "high"],
          },
        ],
      }),
    });

    const first = await handler(
      jsonEvent("/api/settings/translation-codex-defaults", "PATCH", {
        model: "model-id",
        reasoning_effort: "high",
      }),
    );
    const second = await handler(
      jsonEvent("/api/settings/translation-codex-defaults", "PATCH", {
        reasoning_effort: "medium",
      }),
    );
    const settings = await readSettings(apiEvent("/api/settings", "GET"));

    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      codexTranslationModel: "gpt-5.5",
      codexTranslationReasoningEffort: "high",
    });
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      codexTranslationModel: "gpt-5.5",
      codexTranslationReasoningEffort: "medium",
    });
    expect(settings.status).toBe(200);
    await expect(settings.json()).resolves.toMatchObject({
      codexTranslationModel: "gpt-5.5",
      codexTranslationReasoningEffort: "medium",
    });
  });

  it("preserves omitted Codex translation default fields in PATCH payloads", async () => {
    const updates: unknown[] = [];
    const handler = createUpdateCodexTranslationDefaultsHandler({
      readDefaults: async () => ({
        model: null,
        reasoningEffort: null,
      }),
      listModels: async () => ({
        models: [
          {
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "GPT-5.5",
            description: "Frontier model",
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: ["low", "medium", "high"],
          },
        ],
      }),
      updateDefaults: async (input) => {
        updates.push(input);
        return {
          translationTargetLanguage: "ja-JP",
          codexTranslationModel: "gpt-5.5",
          codexTranslationReasoningEffort: input.reasoningEffort ?? null,
          openaiAuth: {
            status: "enabled",
            provider: "codex",
            message: "Codex ChatGPT sign-in is enabled.",
          },
        };
      },
    });

    const response = await handler(
      jsonEvent("/api/settings/translation-codex-defaults", "PATCH", {
        reasoning_effort: "high",
      }),
    );

    expect(response.status).toBe(200);
    expect(updates).toEqual([{ model: undefined, reasoningEffort: "high" }]);
  });

  it("validates omitted model PATCH payloads against the preserved Codex model", async () => {
    const updates: unknown[] = [];
    const handler = createUpdateCodexTranslationDefaultsHandler({
      readDefaults: async () => ({
        model: "gpt-5.3",
        reasoningEffort: "medium",
      }),
      listModels: async () => ({
        models: [
          {
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "GPT-5.5",
            description: "Default model",
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: ["low", "medium"],
          },
          {
            id: "gpt-5.3",
            model: "gpt-5.3",
            displayName: "GPT-5.3",
            description: "Saved model",
            isDefault: false,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: ["high"],
          },
        ],
      }),
      updateDefaults: async (input) => {
        updates.push(input);
        return {
          translationTargetLanguage: "ja-JP",
          codexTranslationModel: "gpt-5.3",
          codexTranslationReasoningEffort: input.reasoningEffort ?? null,
          openaiAuth: {
            status: "enabled",
            provider: "codex",
            message: "Codex ChatGPT sign-in is enabled.",
          },
        };
      },
    });

    const response = await handler(
      jsonEvent("/api/settings/translation-codex-defaults", "PATCH", {
        reasoning_effort: "high",
      }),
    );

    expect(response.status).toBe(200);
    expect(updates).toEqual([{ model: undefined, reasoningEffort: "high" }]);
  });

  it("rejects unavailable Codex translation defaults with stable error codes", async () => {
    const handler = createUpdateCodexTranslationDefaultsHandler({
      listModels: async () => ({
        models: [
          {
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "GPT-5.5",
            description: "Frontier model",
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: ["low", "medium"],
          },
        ],
      }),
      updateDefaults: async () => {
        throw new Error("should not update unavailable defaults");
      },
    });

    const missingModel = await handler(
      jsonEvent("/api/settings/translation-codex-defaults", "PATCH", {
        model: "missing",
        reasoning_effort: "medium",
      }),
    );
    const missingEffort = await handler(
      jsonEvent("/api/settings/translation-codex-defaults", "PATCH", {
        model: "gpt-5.5",
        reasoning_effort: "high",
      }),
    );

    expect(missingModel.status).toBe(409);
    await expect(missingModel.json()).resolves.toMatchObject({
      code: "translation_model_unavailable",
      status: "error",
    });
    expect(missingEffort.status).toBe(409);
    await expect(missingEffort.json()).resolves.toMatchObject({
      code: "translation_reasoning_effort_unavailable",
      status: "error",
    });
  });

  it("returns a safe Codex setup failure when app-server auth is unavailable", async () => {
    await useTempRouteConfig();

    const response = await enableOpenAiAuth(
      apiEvent("/api/settings/openai-auth/enable", "POST"),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      status: "failed",
      provider: "codex",
      loginId: null,
      error: "Codex app-server is unavailable.",
    });
  });

  it("rejects cross-origin empty auth mutations before app-server work", async () => {
    const request = (path: string, method: "DELETE" | "POST") =>
      createApiEvent(
        new Request(`http://localhost${path}`, {
          method,
          headers: { origin: "https://evil.example" },
        }),
      );

    const enabled = await enableOpenAiAuth(
      request("/api/settings/openai-auth/enable", "POST"),
    );
    const deleted = await deleteOpenAiAuth(
      request("/api/settings/openai-auth", "DELETE"),
    );

    expect(enabled.status).toBe(403);
    await expect(enabled.json()).resolves.toEqual({
      error: "same-origin request is required",
    });
    expect(deleted.status).toBe(403);
    await expect(deleted.json()).resolves.toEqual({
      error: "same-origin request is required",
    });
  });

  it("returns a safe error when deleting Codex auth without app-server access", async () => {
    await useTempRouteConfig();
    const deleted = await deleteOpenAiAuth(
      apiEvent("/api/settings/openai-auth", "DELETE"),
    );

    expect(deleted.status).toBe(500);
    expect(await deleted.json()).toEqual({
      error: "Codex app-server is unavailable.",
    });
  });
});

async function useTempRouteConfig() {
  const root = await mkdtemp(join(tmpdir(), "trauma-api-settings-"));
  tempDirs.push(root);
  process.env.TRAUMA_CODEX_APP_SERVER_ENDPOINT = "unix://";
  process.env.TRAUMA_CODEX_APP_SERVER_SOCKET_PATH = join(
    root,
    "missing-codex-app-server.sock",
  );
  return loadRouteConfig(await writeRouteConfig(root));
}

function apiEvent(path: string, method: string) {
  return createApiEvent(
    new Request(`http://localhost${path}`, {
      method,
    }),
  );
}

function jsonEvent(path: string, method: string, body: unknown) {
  return createApiEvent(
    new Request(`http://localhost${path}`, {
      method,
      body: JSON.stringify(body),
    }),
  );
}
