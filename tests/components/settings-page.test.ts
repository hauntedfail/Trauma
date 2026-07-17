import { readFileSync } from "node:fs";

import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import {
  SettingsPage,
  readSafeVerificationUrl,
} from "../../src/components/settings/SettingsPage";
import {
  submitCodexTranslationDefaults,
  submitTranslationDefaults,
  submitReadCodexModels,
  pollCodexAuthSetup,
  submitCancelCodexAuthSetup,
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
  it("renders only credential-free HTTPS device verification links", () => {
    expect(readSafeVerificationUrl("https://example.com/device"))
      .toBe("https://example.com/device");
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,unsafe",
      "http://example.com/device",
      "https://user:secret@example.com/device",
    ]) {
      expect(readSafeVerificationUrl(value)).toBeUndefined();
    }

    const html = renderToString(() =>
      createComponent(SettingsPage, {
        initialSettings: {
          translationTargetLanguage: "ja-JP",
          codexTranslationModel: null,
          codexTranslationReasoningEffort: null,
          openaiAuth: {
            status: "login_started",
            provider: "codex",
            loginId: "login-unsafe",
            verificationUrl: "javascript:alert(1)",
            userCode: "SAFE-CODE",
          },
        },
      }),
    );
    expect(html).toContain("SAFE-CODE");
    expect(html).toContain("Check status");
    expect(html).toContain("Cancel setup");
    expect(html).not.toContain("javascript:");
  });

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

      if (String(input).includes("translation-defaults")) {
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
    await expect(
      submitTranslationDefaults({
        fetch,
        language: "en-US",
        model: "gpt-5.5",
        reasoningEffort: "high",
      }),
    ).resolves.toMatchObject({
      translationTargetLanguage: "en-US",
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
      ["http://localhost/api/settings/translation-defaults", "PATCH"],
      ["http://localhost/api/settings/codex-auth/device-code", "POST"],
      ["http://localhost/api/settings/codex-auth", "DELETE"],
    ]);
  });

  it.each([
    ["invalid JSON", () => new Response("not-json", { status: 200 })],
    ["a null root", () => jsonResponse(null)],
    ["an empty object", () => jsonResponse({})],
    ["a null models field", () => jsonResponse({ models: null })],
    [
      "a malformed model row",
      () => jsonResponse({
        models: [
          {
            id: "frontier",
            model: "gpt-5.5",
            displayName: "GPT-5.5",
            description: "Frontier model",
            isDefault: "yes",
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: ["low", "medium", "high"],
          },
        ],
      }),
    ],
    [
      "an unknown reasoning effort",
      () => jsonResponse({
        models: [
          {
            id: "frontier",
            model: "gpt-5.5",
            displayName: "GPT-5.5",
            description: "Frontier model",
            isDefault: true,
            defaultReasoningEffort: "extreme",
            supportedReasoningEfforts: ["medium", "extreme"],
          },
        ],
      }),
    ],
  ])("rejects %s from a successful Codex model request", async (_label, response) => {
    await expect(submitReadCodexModels({
      fetch: async () => response(),
    })).rejects.toThrow("Codex model catalog response was invalid.");
  });

  it("accepts future Codex catalog and model fields", async () => {
    await expect(submitReadCodexModels({
      fetch: async () => jsonResponse({
        future_catalog_field: { enabled: true },
        models: [
          {
            id: "frontier",
            model: "gpt-5.5",
            displayName: "GPT-5.5",
            description: "Frontier model",
            isDefault: true,
            defaultReasoningEffort: "medium",
            future_model_field: 1,
            supportedReasoningEfforts: ["none", "minimal", "low", "medium", "high", "xhigh"],
          },
        ],
      }),
    })).resolves.toMatchObject({
      models: [{ model: "gpt-5.5" }],
    });
  });

  it("preserves non-2xx Codex catalog messages", async () => {
    await expect(submitReadCodexModels({
      fetch: async () => new Response(JSON.stringify({
        message: "Catalog temporarily unavailable.",
      }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    })).rejects.toThrow("Catalog temporarily unavailable.");
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
    const controller = new AbortController();

    await expect(
      submitReadCodexAuth({
        signal: controller.signal,
        fetch: async (input, init) => {
          expect(init?.signal).toBe(controller.signal);
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

  it("aborts an in-flight Codex auth status read without projecting a failure", async () => {
    const controller = new AbortController();
    let resolveStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    let requestSignal: AbortSignal | null | undefined;
    const polling = pollCodexAuthSetup({
      intervalMs: 0,
      maxAttempts: 1,
      signal: controller.signal,
      fetch: async (_input, init) => {
        requestSignal = init?.signal;
        resolveStarted();
        return new Promise<Response>((_resolve, reject) => {
          controller.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    });

    await started;
    controller.abort();

    await expect(polling).resolves.toBeUndefined();
    expect(requestSignal).toBe(controller.signal);
  });

  it("treats AbortError as polling cancellation but preserves other failures", async () => {
    await expect(
      pollCodexAuthSetup({
        fetch: async () => {
          throw new DOMException("Aborted", "AbortError");
        },
        intervalMs: 0,
        maxAttempts: 1,
      }),
    ).resolves.toBeUndefined();
    await expect(
      pollCodexAuthSetup({
        fetch: async () => {
          throw new Error("auth network failed");
        },
        intervalMs: 0,
        maxAttempts: 1,
      }),
    ).rejects.toThrow("auth network failed");
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

  it("returns the last canonical auth state when polling is exhausted", async () => {
    let reads = 0;
    const pending = {
      status: "login_started" as const,
      provider: "codex" as const,
      loginId: "login-timeout",
      verificationUrl: "https://example.com/device",
      userCode: "TIME-OUT",
    };

    await expect(
      pollCodexAuthSetup({
        fetch: async () => {
          reads += 1;
          return jsonResponse(pending);
        },
        intervalMs: 0,
        maxAttempts: 2,
      }),
    ).resolves.toEqual(pending);
    expect(reads).toBe(2);
  });

  it("cancels pending Codex device setup through its mutation route", async () => {
    const requests: Request[] = [];
    await expect(
      submitCancelCodexAuthSetup({
        fetch: async (input, init) => {
          requests.push(new Request(new URL(String(input), "http://localhost"), init));
          return jsonResponse({
            status: "canceled",
            provider: "codex",
            loginId: "login-1",
          });
        },
      }),
    ).resolves.toMatchObject({ status: "canceled", loginId: "login-1" });
    expect(requests.map((request) => [request.url, request.method])).toEqual([
      ["http://localhost/api/settings/codex-auth/device-code/cancel", "POST"],
    ]);
  });

  it("wires pending Codex auth setup to the polling helper", () => {
    expect(settingsPageSource).toContain("pollCodexAuthSetup");
    expect(settingsPageSource).toContain("refreshCodexAuthAfterLogin");
    expect(settingsPageSource).toContain(
      'props.initialSettings.openaiAuth.status === "login_started"',
    );
    expect(settingsPageSource).toContain("cancelOpenAiAuthSetup");
    expect(settingsPageSource).toContain("refreshCodexAuthStatus");
    expect(settingsPageSource).toContain("controller.signal.aborted");
    expect(settingsPageSource).toContain("!actionTracker.isCurrent(action)");
    expect(settingsPageSource.indexOf("abortCodexAuthPolls();")).toBeLessThan(
      settingsPageSource.indexOf("await submitCancelCodexAuthSetup()"),
    );
  });

  it("tracks concurrent settings actions without a shared pending slot", () => {
    expect(settingsPageSource).toContain("createAsyncActionTracker");
    expect(settingsPageSource).toContain("pendingActions().has(action)");
    expect(settingsPageSource).not.toContain(
      'const [pending, setPending] = createSignal("")',
    );
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
