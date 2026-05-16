import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GET as readSettings } from "../../../src/routes/api/settings";
import { PATCH as updateLanguage } from "../../../src/routes/api/settings/translation-language";
import { DELETE as deleteOpenAiAuth } from "../../../src/routes/api/settings/openai-auth";
import { POST as enableOpenAiAuth } from "../../../src/routes/api/settings/openai-auth/enable";
import { initializeDatabase } from "../../../src/server/db";
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
    const config = await useTempRouteConfig();
    const connection = initializeDatabase(config);
    try {
      await connection.repositories.settings.createOpenAiAuthCredential({
        provider: "codex",
        credentialReference: "external-openai-auth",
        now: new Date("2026-05-15T00:00:00.000Z"),
      });
    } finally {
      connection.close();
    }

    const response = await readSettings(apiEvent("/api/settings", "GET"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      translationTargetLanguage: "ja-JP",
      openaiAuth: { status: "enabled" },
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

  it("returns not configured when OpenAI auth provider is missing", async () => {
    const config = await useTempRouteConfig();

    const response = await enableOpenAiAuth(
      apiEvent("/api/settings/openai-auth/enable", "POST"),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      status: "not_configured",
      message: "OpenAI auth provider is not configured.",
    });

    const connection = initializeDatabase(config);
    try {
      expect(
        connection.sqlite
          .prepare("select count(*) as count from openai_auth_credentials")
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      connection.close();
    }
  });

  it("keeps existing OpenAI auth idempotent and deletes it", async () => {
    const config = await useTempRouteConfig();
    const connection = initializeDatabase(config);
    try {
      await connection.repositories.settings.createOpenAiAuthCredential({
        provider: "codex",
        credentialReference: "external-openai-auth",
        now: new Date("2026-05-15T00:00:00.000Z"),
      });
    } finally {
      connection.close();
    }

    const alreadyEnabled = await enableOpenAiAuth(
      apiEvent("/api/settings/openai-auth/enable", "POST"),
    );
    const deleted = await deleteOpenAiAuth(
      apiEvent("/api/settings/openai-auth", "DELETE"),
    );
    const alreadyDisabled = await deleteOpenAiAuth(
      apiEvent("/api/settings/openai-auth", "DELETE"),
    );

    expect(alreadyEnabled.status).toBe(200);
    expect(await alreadyEnabled.json()).toEqual({
      status: "enabled",
      alreadyEnabled: true,
      message: "OpenAI auth is already enabled.",
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({
      status: "disabled",
      alreadyDisabled: false,
    });
    expect(alreadyDisabled.status).toBe(200);
    expect(await alreadyDisabled.json()).toEqual({
      status: "disabled",
      alreadyDisabled: true,
    });
  });
});

async function useTempRouteConfig() {
  const root = await mkdtemp(join(tmpdir(), "trauma-api-settings-"));
  tempDirs.push(root);
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
