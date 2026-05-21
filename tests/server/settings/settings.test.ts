import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initializeDatabase } from "../../../src/server/db";
import {
  deleteSettingsOpenAiAuth,
  enableSettingsOpenAiAuth,
  getSettings,
  updateTranslationTargetLanguage,
  UnsupportedTranslationLanguageError,
} from "../../../src/server/settings/settings";
import {
  loadRouteConfig,
  writeRouteConfig,
} from "../routes/api-test-helpers";

const originalEnv = { ...process.env };
const tempDirs: string[] = [];

afterEach(async () => {
  process.env = { ...originalEnv };
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("settings service", () => {
  it("initializes the settings singleton with the default translation target language", async () => {
    const config = await makeConfig();

    await expect(getSettings({ config })).resolves.toEqual({
      translationTargetLanguage: "ja-JP",
      openaiAuth: {
        status: "setup_required",
        provider: "codex",
        reason: "codex_app_server_unavailable",
      },
    });

    const connection = initializeDatabase(config);
    try {
      expect(
        connection.sqlite.prepare("select id, translation_target_language from app_settings").all(),
      ).toEqual([{ id: "default", translation_target_language: "ja-JP" }]);
    } finally {
      connection.close();
    }
  });

  it("initializes the settings singleton idempotently under concurrent first reads", async () => {
    const config = await makeConfig();

    await expect(
      Promise.all([
        getSettings({ config, now: new Date("2026-05-15T00:00:00.000Z") }),
        getSettings({ config, now: new Date("2026-05-15T00:00:01.000Z") }),
      ]),
    ).resolves.toEqual([
      {
        translationTargetLanguage: "ja-JP",
        openaiAuth: {
          status: "setup_required",
          provider: "codex",
          reason: "codex_app_server_unavailable",
        },
      },
      {
        translationTargetLanguage: "ja-JP",
        openaiAuth: {
          status: "setup_required",
          provider: "codex",
          reason: "codex_app_server_unavailable",
        },
      },
    ]);

    const connection = initializeDatabase(config);
    try {
      expect(
        connection.sqlite
          .prepare("select count(*) as count from app_settings")
          .get(),
      ).toEqual({ count: 1 });
    } finally {
      connection.close();
    }
  });

  it("persists valid translation target language updates", async () => {
    const config = await makeConfig();

    await expect(
      updateTranslationTargetLanguage("en-US", { config }),
    ).resolves.toMatchObject({
      translationTargetLanguage: "en-US",
    });
    await expect(getSettings({ config })).resolves.toMatchObject({
      translationTargetLanguage: "en-US",
    });
  });

  it("rejects unsupported translation target languages", async () => {
    const config = await makeConfig();

    await expect(
      updateTranslationTargetLanguage("xx-XX", { config }),
    ).rejects.toBeInstanceOf(UnsupportedTranslationLanguageError);
  });

  it("returns not configured when enabling OpenAI auth without a real provider", async () => {
    const config = await makeConfig();

    await expect(
      enableSettingsOpenAiAuth({
        config,
        now: new Date("2026-05-15T00:00:00.000Z"),
      }),
    ).resolves.toEqual({
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

  it("keeps existing OpenAI auth idempotent without overwriting auth state", async () => {
    const config = await makeConfig();
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

    const first = await enableSettingsOpenAiAuth({
      config,
      now: new Date("2026-05-16T00:00:00.000Z"),
    });
    const second = await enableSettingsOpenAiAuth({
      config,
      now: new Date("2026-05-17T00:00:00.000Z"),
    });

    expect(first).toEqual({
      status: "enabled",
      alreadyEnabled: true,
      message: "OpenAI auth is already enabled.",
    });
    expect(second).toEqual({
      status: "enabled",
      alreadyEnabled: true,
      message: "OpenAI auth is already enabled.",
    });

    const verifyConnection = initializeDatabase(config);
    try {
      expect(
        verifyConnection.sqlite
          .prepare("select provider, credential_reference, created_at, updated_at from openai_auth_credentials")
          .all(),
      ).toEqual([
        {
          provider: "codex",
          credential_reference: "external-openai-auth",
          created_at: new Date("2026-05-15T00:00:00.000Z").getTime(),
          updated_at: new Date("2026-05-15T00:00:00.000Z").getTime(),
        },
      ]);
    } finally {
      verifyConnection.close();
    }
  });

  it("deletes OpenAI auth without deleting app settings", async () => {
    const config = await makeConfig();
    await updateTranslationTargetLanguage("fr-FR", { config });
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

    await expect(deleteSettingsOpenAiAuth({ config })).resolves.toEqual({
      status: "disabled",
      alreadyDisabled: false,
    });
    await expect(deleteSettingsOpenAiAuth({ config })).resolves.toEqual({
      status: "disabled",
      alreadyDisabled: true,
    });
    await expect(getSettings({ config })).resolves.toEqual({
      translationTargetLanguage: "fr-FR",
      openaiAuth: {
        status: "setup_required",
        provider: "codex",
        reason: "codex_app_server_unavailable",
      },
    });
  });
});

async function makeConfig() {
  const root = await mkdtemp(join(tmpdir(), "trauma-settings-"));
  tempDirs.push(root);
  process.env.TRAUMA_CODEX_APP_SERVER_ENDPOINT = "unix://";
  process.env.TRAUMA_CODEX_APP_SERVER_SOCKET_PATH = join(
    root,
    "missing-codex-app-server.sock",
  );
  return loadRouteConfig(await writeRouteConfig(root));
}
