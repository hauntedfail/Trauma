import { readFileSync } from "node:fs";

import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import { SettingsPage } from "../../src/components/settings/SettingsPage";
import {
  submitCodexTranslationDefaults,
  submitReadCodexModels,
  pollCodexAuthSetup,
  submitDeleteOpenAiAuth,
  submitEnableOpenAiAuth,
  submitReadCodexAuth,
  submitTranslationTargetLanguage,
} from "../../src/components/settings/settings-submit";

const appShellSource = readFileSync("src/components/shell/AppShell.tsx", "utf8");
const settingsPageSource = readFileSync(
  "src/components/settings/SettingsPage.tsx",
  "utf8",
);

describe("settings page", () => {
  it("renders translation language options and disabled OpenAI auth controls", () => {
    const html = renderToString(() =>
      createComponent(SettingsPage, {
        initialSettings: {
          translationTargetLanguage: "ja-JP",
          codexTranslationModel: null,
          codexTranslationReasoningEffort: null,
          openaiAuth: {
            status: "setup_required",
            provider: "codex",
            reason: "codex_app_server_unavailable",
          },
        },
      }),
    );

    expect(html).toContain('aria-labelledby="settings-title"');
    expect(html).toContain('id="settings-title"');
    expect(html).toContain("Translation target language");
    expect(html).toContain("Codex Translation");
    expect(html).toContain("Codex app-server default");
    expect(html).toContain("Selected model default");
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
    expect(html).toContain("Start setup");
    expect(html).not.toContain("Delete auth");
  });

  it("renders enabled Codex auth state with a danger delete action", () => {
    const html = renderToString(() =>
      createComponent(SettingsPage, {
        initialSettings: {
          translationTargetLanguage: "en-US",
          codexTranslationModel: "gpt-5.5",
          codexTranslationReasoningEffort: "high",
          openaiAuth: {
            status: "enabled",
            provider: "codex",
            message: "Codex ChatGPT sign-in is enabled.",
          },
        },
      }),
    );

    expect(html).toContain("Enabled");
    expect(html).toContain("Codex ChatGPT sign-in is enabled.");
    expect(html).toContain("gpt-5.5");
    expect(html).toContain("high");
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
          codexTranslationModel: null,
          codexTranslationReasoningEffort: null,
          openaiAuth: {
            status: "setup_required",
            provider: "codex",
            reason: "codex_app_server_unavailable",
          },
        });
      }

      if (String(input).includes("device-code")) {
        return jsonResponse({
          status: "login_started",
          provider: "codex",
          loginId: "login-1",
          verificationUrl: "https://example.com/device",
          userCode: "ABCD-EFGH",
        });
      }

      if (String(input).includes("codex-models")) {
        return jsonResponse({
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
      }

      if (String(input).includes("translation-codex-defaults")) {
        return jsonResponse({
          translationTargetLanguage: "en-US",
          codexTranslationModel: "gpt-5.5",
          codexTranslationReasoningEffort: "high",
          openaiAuth: {
            status: "setup_required",
            provider: "codex",
            reason: "codex_app_server_unavailable",
          },
        });
      }

      return jsonResponse({
        status: "disabled",
        provider: "codex",
        logoutStatus: "logged_out",
      });
    };

    await expect(
      submitTranslationTargetLanguage({ language: "en-US", fetch }),
    ).resolves.toMatchObject({ translationTargetLanguage: "en-US" });
    await expect(submitReadCodexModels({ fetch })).resolves.toMatchObject({
      models: [{ model: "gpt-5.5" }],
    });
    await expect(
      submitCodexTranslationDefaults({
        fetch,
        model: "gpt-5.5",
        reasoningEffort: "high",
      }),
    ).resolves.toMatchObject({
      codexTranslationModel: "gpt-5.5",
      codexTranslationReasoningEffort: "high",
    });
    await expect(submitEnableOpenAiAuth({ fetch })).resolves.toEqual({
      status: "login_started",
      provider: "codex",
      loginId: "login-1",
      verificationUrl: "https://example.com/device",
      userCode: "ABCD-EFGH",
    });
    await expect(
      submitDeleteOpenAiAuth({ confirm: () => true, fetch }),
    ).resolves.toEqual({
      status: "disabled",
      provider: "codex",
      logoutStatus: "logged_out",
    });

    expect(requests.map((request) => [request.url, request.method])).toEqual([
      ["http://localhost/api/settings/translation-language", "PATCH"],
      ["http://localhost/api/settings/codex-models", "GET"],
      ["http://localhost/api/settings/translation-codex-defaults", "PATCH"],
      ["http://localhost/api/settings/codex-auth/device-code", "POST"],
      ["http://localhost/api/settings/codex-auth", "DELETE"],
    ]);
  });

  it("surfaces Codex auth device-code failures", async () => {
    await expect(
      submitEnableOpenAiAuth({
        fetch: async () =>
          new Response(
            JSON.stringify({
              status: "failed",
              provider: "codex",
              error: "Codex app-server is unavailable.",
            }),
            {
              status: 409,
              headers: { "content-type": "application/json" },
            },
          ),
      }),
    ).rejects.toThrow("Codex app-server is unavailable.");
  });

  it("reads Codex auth status through the settings API", async () => {
    const requests: Request[] = [];

    await expect(
      submitReadCodexAuth({
        fetch: async (input, init) => {
          requests.push(new Request(new URL(String(input), "http://localhost"), init));
          return jsonResponse({
            status: "enabled",
            provider: "codex",
            message: "Codex ChatGPT sign-in is enabled.",
          });
        },
      }),
    ).resolves.toEqual({
      status: "enabled",
      provider: "codex",
      message: "Codex ChatGPT sign-in is enabled.",
    });

    expect(requests.map((request) => [request.url, request.method])).toEqual([
      ["http://localhost/api/settings/codex-auth", "GET"],
    ]);
  });

  it("polls Codex auth setup until device-code login is enabled", async () => {
    const requests: Request[] = [];
    let reads = 0;

    await expect(
      pollCodexAuthSetup({
        fetch: async (input, init) => {
          requests.push(new Request(new URL(String(input), "http://localhost"), init));
          reads += 1;
          if (reads === 1) {
            return jsonResponse({
              status: "login_started",
              provider: "codex",
              loginId: "login-1",
              verificationUrl: "https://example.com/device",
              userCode: "ABCD-EFGH",
            });
          }
          return jsonResponse({
            status: "enabled",
            provider: "codex",
            message: "Codex ChatGPT sign-in is enabled.",
          });
        },
        intervalMs: 0,
        maxAttempts: 3,
      }),
    ).resolves.toEqual({
      status: "enabled",
      provider: "codex",
      message: "Codex ChatGPT sign-in is enabled.",
    });

    expect(requests.map((request) => [request.url, request.method])).toEqual([
      ["http://localhost/api/settings/codex-auth", "GET"],
      ["http://localhost/api/settings/codex-auth", "GET"],
    ]);
  });

  it("wires pending Codex auth setup to the polling helper", () => {
    expect(settingsPageSource).toContain("pollCodexAuthSetup");
    expect(settingsPageSource).toContain("refreshCodexAuthAfterLogin");
  });

  it("does not delete OpenAI auth when confirmation is rejected", async () => {
    const requests: Request[] = [];

    await expect(
      submitDeleteOpenAiAuth({
        confirm: () => false,
        fetch: async (input, init) => {
          requests.push(new Request(new URL(String(input), "http://localhost"), init));
          return jsonResponse({
            status: "disabled",
            provider: "codex",
            logoutStatus: "logged_out",
          });
        },
      }),
    ).resolves.toBeUndefined();
    expect(requests).toEqual([]);
  });

  it("keeps Codex auth enabled and surfaces the server message when logout is unsupported", () => {
    expect(settingsPageSource).toContain('response.status === "unsupported"');
    expect(settingsPageSource).toContain("response.message");
    expect(settingsPageSource).toContain("Codex auth logout is unsupported.");
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
