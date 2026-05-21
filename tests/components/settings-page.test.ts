import { readFileSync } from "node:fs";

import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import { SettingsPage } from "../../src/components/settings/SettingsPage";
import {
  submitDeleteOpenAiAuth,
  submitEnableOpenAiAuth,
  submitTranslationTargetLanguage,
} from "../../src/components/settings/settings-submit";

const appShellSource = readFileSync("src/components/shell/AppShell.tsx", "utf8");

describe("settings page", () => {
  it("renders translation language options and disabled OpenAI auth controls", () => {
    const html = renderToString(() =>
      createComponent(SettingsPage, {
        initialSettings: {
          translationTargetLanguage: "ja-JP",
          openaiAuth: { status: "disabled" },
        },
      }),
    );

    expect(html).toContain('aria-labelledby="settings-title"');
    expect(html).toContain('id="settings-title"');
    expect(html).toContain("Translation target language");
    for (const label of [
      "Japanese",
      "English",
      "Korean",
      "Chinese",
      "French",
      "German",
      "Spanish",
      "Portuguese",
    ]) {
      expect(html).toContain(label);
    }
    for (const code of [
      "ja-JP",
      "en-US",
      "en-GB",
      "ko-KR",
      "zh-CN",
      "zh-TW",
      "fr-FR",
      "de-DE",
      "es-ES",
      "pt-BR",
    ]) {
      expect(html).toContain(code);
    }
    expect(html).toContain("Enable");
    expect(html).not.toContain("Delete auth");
  });

  it("renders enabled OpenAI auth state with a danger delete action", () => {
    const html = renderToString(() =>
      createComponent(SettingsPage, {
        initialSettings: {
          translationTargetLanguage: "en-US",
          openaiAuth: { status: "enabled" },
        },
      }),
    );

    expect(html).toContain("Enabled");
    expect(html).toContain("OpenAI auth is enabled.");
    expect(html).toContain("Delete auth");
  });

  it("exposes settings in desktop and phone navigation", () => {
    expect(appShellSource).toContain('href: "/settings"');
    expect(appShellSource).toContain("settingsNavItem");
    expect(appShellSource).not.toContain('href="/backup"');
  });

  it("submits settings updates through the expected API endpoints", async () => {
    const requests: Request[] = [];
    const fetch = async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(new URL(String(input), "http://localhost"), init));
      if (String(input).includes("translation-language")) {
        return jsonResponse({
          translationTargetLanguage: "en-US",
          openaiAuth: { status: "disabled" },
        });
      }

      if (String(input).includes("enable")) {
        return jsonResponse({ status: "enabled", alreadyEnabled: true });
      }

      return jsonResponse({ status: "disabled", alreadyDisabled: false });
    };

    await expect(
      submitTranslationTargetLanguage({ language: "en-US", fetch }),
    ).resolves.toMatchObject({ translationTargetLanguage: "en-US" });
    await expect(submitEnableOpenAiAuth({ fetch })).resolves.toEqual({
      status: "enabled",
      alreadyEnabled: true,
    });
    await expect(
      submitDeleteOpenAiAuth({ confirm: () => true, fetch }),
    ).resolves.toEqual({
      status: "disabled",
      alreadyDisabled: false,
    });

    expect(requests.map((request) => [request.url, request.method])).toEqual([
      ["http://localhost/api/settings/translation-language", "PATCH"],
      ["http://localhost/api/settings/openai-auth/enable", "POST"],
      ["http://localhost/api/settings/openai-auth", "DELETE"],
    ]);
  });

  it("surfaces provider-missing OpenAI auth enable responses", async () => {
    await expect(
      submitEnableOpenAiAuth({
        fetch: async () =>
          new Response(
            JSON.stringify({
              status: "not_configured",
              message: "OpenAI auth provider is not configured.",
            }),
            {
              status: 409,
              headers: { "content-type": "application/json" },
            },
          ),
      }),
    ).rejects.toThrow("OpenAI auth provider is not configured.");
  });

  it("does not delete OpenAI auth when confirmation is rejected", async () => {
    const requests: Request[] = [];

    await expect(
      submitDeleteOpenAiAuth({
        confirm: () => false,
        fetch: async (input, init) => {
          requests.push(new Request(new URL(String(input), "http://localhost"), init));
          return jsonResponse({ status: "disabled", alreadyDisabled: false });
        },
      }),
    ).resolves.toBeUndefined();
    expect(requests).toEqual([]);
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
