import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GET as readSettings } from "../../../src/routes/api/settings";
import { PATCH as updateLanguage } from "../../../src/routes/api/settings/translation-language";
import { DELETE as deleteOpenAiAuth } from "../../../src/routes/api/settings/openai-auth";
import { POST as enableOpenAiAuth } from "../../../src/routes/api/settings/openai-auth/enable";
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
      error: "Cannot connect to Codex app-server Unix socket.",
    });
  });

  it("returns a safe error when deleting Codex auth without app-server access", async () => {
    await useTempRouteConfig();
    const deleted = await deleteOpenAiAuth(
      apiEvent("/api/settings/openai-auth", "DELETE"),
    );

    expect(deleted.status).toBe(500);
    expect(await deleted.json()).toEqual({
      error: "Cannot connect to Codex app-server Unix socket.",
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
