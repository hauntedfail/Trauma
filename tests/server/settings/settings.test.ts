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
      openaiAuth: { status: "disabled" },
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

  it("enables OpenAI auth idempotently without overwriting existing auth state", async () => {
    const config = await makeConfig();
    const first = await enableSettingsOpenAiAuth({
      config,
      now: new Date("2026-05-15T00:00:00.000Z"),
    });
    const second = await enableSettingsOpenAiAuth({
      config,
      now: new Date("2026-05-16T00:00:00.000Z"),
    });

    expect(first).toEqual({ status: "enabled", alreadyEnabled: false });
    expect(second).toEqual({
      status: "enabled",
      alreadyEnabled: true,
      message: "OpenAI auth is already enabled.",
    });

    const connection = initializeDatabase(config);
    try {
      expect(
        connection.sqlite
          .prepare("select provider, credential_reference, created_at, updated_at from openai_auth_credentials")
          .all(),
      ).toEqual([
        {
          provider: "task18-local",
          credential_reference: "task18-local-openai-auth",
          created_at: new Date("2026-05-15T00:00:00.000Z").getTime(),
          updated_at: new Date("2026-05-15T00:00:00.000Z").getTime(),
        },
      ]);
    } finally {
      connection.close();
    }
  });

  it("deletes OpenAI auth without deleting app settings", async () => {
    const config = await makeConfig();
    await updateTranslationTargetLanguage("fr-FR", { config });
    await enableSettingsOpenAiAuth({ config });

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
      openaiAuth: { status: "disabled" },
    });
  });
});

async function makeConfig() {
  const root = await mkdtemp(join(tmpdir(), "trauma-settings-"));
  tempDirs.push(root);
  return loadRouteConfig(await writeRouteConfig(root));
}
