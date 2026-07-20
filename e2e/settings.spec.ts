import { expect, test } from "@playwright/test";

import {
  ensureE2eRuntimeFixture,
  runBunFixtureScript,
} from "./bun-fixture";

test.beforeEach(() => {
  ensureE2eRuntimeFixture();
});

test("recovers a malformed Codex catalog without losing saved defaults", async ({
  page,
}) => {
  seedCodexTranslationDefaults({
    model: "gpt-5.5",
    reasoningEffort: "high",
  });
  let catalogRequestCount = 0;
  let releaseRetryRequest: () => void = () => undefined;
  const retryRequestGate = new Promise<void>((resolve) => {
    releaseRetryRequest = resolve;
  });
  await page.route("**/api/settings/codex-models", async (route) => {
    catalogRequestCount += 1;
    if (catalogRequestCount === 1) {
      await route.fulfill({
        contentType: "application/json",
        status: 200,
        body: JSON.stringify({ models: null }),
      });
      return;
    }

    await retryRequestGate;
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({
        models: [
          {
            id: "frontier",
            model: "gpt-5.5",
            displayName: "GPT-5.5",
            description: "Frontier model",
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: ["low", "medium", "high"],
          },
          {
            id: "fast",
            model: "gpt-5.3",
            displayName: "GPT-5.3",
            description: "Fast model",
            isDefault: false,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: ["medium", "high"],
          },
        ],
      }),
    });
  });

  try {
    await page.goto("/settings");

    const alert = page.getByRole("alert");
    const retry = alert.getByRole("button", { name: /^Retry/ });
    const model = page.getByRole("combobox", { name: "Model", exact: true });
    const effort = page.getByRole("combobox", {
      name: "Reasoning effort",
      exact: true,
    });
    const save = page.getByRole("button", { name: "Save Codex defaults" });

    await expect(
      alert.getByText("Codex model catalog response was invalid.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(retry).toBeEnabled();
    await expect(retry).toHaveAccessibleName("Retry");
    await expect(model).toBeEnabled();
    await expect(model).toHaveValue("gpt-5.5");
    await expect(effort).toHaveValue("high");
    await expect(save).toBeEnabled();
    expect(catalogRequestCount).toBe(1);

    await retry.click();
    await expect.poll(() => catalogRequestCount).toBe(2);
    await expect(retry).toBeDisabled();
    await expect(retry).toHaveAccessibleName("Retrying...");
    await expect(model).toBeDisabled();
    await expect(model).toHaveValue("gpt-5.5");
    await expect(effort).toBeDisabled();
    await expect(effort).toHaveValue("high");
    await expect(save).toBeDisabled();

    await retry.evaluate((button: HTMLButtonElement) => button.click());
    releaseRetryRequest();

    await expect(alert).toHaveCount(0);
    await expect(model).toBeEnabled();
    await expect(model).toHaveValue("gpt-5.5");
    await expect(effort).toBeEnabled();
    await expect(effort).toHaveValue("high");
    await expect(save).toBeEnabled();
    await expect(model).toBeFocused();
    expect(catalogRequestCount).toBe(2);

    await model.selectOption("gpt-5.3");
    await effort.selectOption("medium");
    await expect(model).toHaveValue("gpt-5.3");
    await expect(effort).toHaveValue("medium");
  } finally {
    releaseRetryRequest();
  }
});

test("aborts an in-flight Codex auth poll without restoring stale controls", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    let authStatusReads = 0;
    Object.assign(window, {
      __traumaAuthPollAborted: false,
      __traumaAuthPollSignalPassed: false,
      __traumaAuthPollStarted: false,
    });
    Object.defineProperty(window, "fetch", {
      configurable: true,
      value: async (
        input: Parameters<typeof window.fetch>[0],
        init?: Parameters<typeof window.fetch>[1],
      ) => {
        const request = input instanceof Request ? input : undefined;
        const url = new URL(request?.url ?? String(input), window.location.href);
        const method = init?.method ?? request?.method ?? "GET";
        if (
          url.pathname === "/api/settings/codex-auth" &&
          method === "GET"
        ) {
          authStatusReads += 1;
          if (authStatusReads === 1) {
            const state = window as typeof window & {
              __traumaAuthPollAborted: boolean;
              __traumaAuthPollSignalPassed: boolean;
              __traumaAuthPollStarted: boolean;
            };
            state.__traumaAuthPollSignalPassed =
              init?.signal instanceof AbortSignal;
            state.__traumaAuthPollStarted = true;
            return new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener(
                "abort",
                () => {
                  state.__traumaAuthPollAborted = true;
                  reject(new DOMException("Aborted", "AbortError"));
                },
                { once: true },
              );
            });
          }

          return new Response(JSON.stringify({
            status: "setup_required",
            provider: "codex",
            reason: "codex_app_server_unavailable",
          }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }

        return nativeFetch(input, init);
      },
      writable: true,
    });
  });
  await page.route("**/api/settings/codex-models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ models: [] }),
    });
  });
  await page.route("**/api/settings/codex-auth/device-code", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        status: "login_started",
        provider: "codex",
        loginId: "login-e2e",
        verificationUrl: "https://example.com/device",
        userCode: "E2E-CODE",
      }),
    });
  });
  await page.route(
    "**/api/settings/codex-auth/device-code/cancel",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          status: "canceled",
          provider: "codex",
          loginId: "login-e2e",
        }),
      });
    },
  );

  await page.goto("/settings");
  await page.getByRole("button", { name: "Start setup" }).click();
  await expect(page.getByText("E2E-CODE")).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { __traumaAuthPollStarted?: boolean })
      .__traumaAuthPollStarted === true
  )).toBe(true);

  await page.getByRole("button", { name: "Cancel setup" }).click();

  await expect.poll(() => page.evaluate(() => {
    const state = window as typeof window & {
      __traumaAuthPollAborted?: boolean;
      __traumaAuthPollSignalPassed?: boolean;
    };
    return state.__traumaAuthPollSignalPassed === true &&
      state.__traumaAuthPollAborted === true;
  })).toBe(true);
  await expect(page.getByRole("button", { name: "Start setup" })).toBeEnabled();
  await expect(page.getByRole("status")).toContainText(
    "Codex auth setup canceled. You can start again.",
  );
  await expect(page.getByRole("button", { name: "Enabled" })).toHaveCount(0);
});

test("moves supported logout focus to setup without overriding the user", async ({
  page,
}) => {
  const settingsStateQueryId =
    "src_components_settings_settings-loader_ts--getSettingsState_query";
  let releaseRevalidation: (() => void) | undefined;
  const revalidationGate = new Promise<void>((resolve) => {
    releaseRevalidation = resolve;
  });
  let releaseSecondDelete: (() => void) | undefined;
  const secondDeleteGate = new Promise<void>((resolve) => {
    releaseSecondDelete = resolve;
  });
  let markSecondDeleteStarted: (() => void) | undefined;
  const secondDeleteStarted = new Promise<void>((resolve) => {
    markSecondDeleteStarted = resolve;
  });
  let deleteRequestCount = 0;
  await page.route("**/api/settings/codex-auth/device-code", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        status: "enabled",
        provider: "codex",
        message: "Codex ChatGPT sign-in is enabled.",
      }),
    });
  });
  await page.route("**/api/settings/codex-auth", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.continue();
      return;
    }
    deleteRequestCount += 1;
    if (deleteRequestCount === 2) {
      markSecondDeleteStarted?.();
      await secondDeleteGate;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        status: "disabled",
        provider: "codex",
        logoutStatus: "logged_out",
      }),
    });
  });

  try {
    await page.goto("/settings");
    await page.route(
      (url) =>
        url.pathname === "/_server/" &&
        url.searchParams.get("id") === settingsStateQueryId,
      async (route) => {
        await revalidationGate;
        await route.continue();
      },
    );

    const setup = page.getByRole("button", { name: "Start setup" });
    const enabled = page.getByRole("button", { name: "Enabled" });
    await expect(async () => {
      if (await enabled.count() === 0) {
        await setup.click();
      }
      await expect(enabled).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 5_000 });
    await page.getByRole("button", { name: "Delete auth" }).click();
    let confirmation = page.getByRole("dialog", {
      name: "Delete Codex auth confirmation",
    });
    await confirmation.getByRole("button", { name: "Cancel" }).press("Tab");
    await confirmation.getByRole("button", { name: "Delete auth" }).press("Enter");

    await expect(setup).toBeEnabled();
    await expect(setup).toBeFocused();
    expect(deleteRequestCount).toBe(1);

    await expect(async () => {
      if (await enabled.count() === 0) {
        await setup.click();
      }
      await expect(enabled).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 5_000 });
    await page.getByRole("button", { name: "Delete auth" }).click();
    confirmation = page.getByRole("dialog", {
      name: "Delete Codex auth confirmation",
    });
    await confirmation.getByRole("button", { name: "Cancel" }).press("Tab");
    await confirmation.getByRole("button", { name: "Delete auth" }).press("Enter");
    await secondDeleteStarted;
    await expect(confirmation.locator("[aria-busy='true']")).toBeFocused();

    const themeTrigger = page.getByRole("button", { name: "Theme" });
    await themeTrigger.click();
    await expect(confirmation).toHaveCount(0);
    await expect(themeTrigger).toBeFocused();
    const deleteResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/settings/codex-auth") &&
        response.request().method() === "DELETE",
    );
    releaseSecondDelete?.();

    expect((await deleteResponse).status()).toBe(200);
    await expect(setup).toBeEnabled();
    await expect(themeTrigger).toBeFocused();
    expect(deleteRequestCount).toBe(2);
  } finally {
    releaseSecondDelete?.();
    releaseRevalidation?.();
  }
});

function seedCodexTranslationDefaults(input: {
  model: string | null;
  reasoningEffort:
    | "none"
    | "minimal"
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | null;
}): void {
  runBunFixtureScript(`
        import { Database } from "bun:sqlite";
        import { join } from "node:path";

        const database = new Database(
          join(process.cwd(), ".trauma/e2e/runtime/trauma.sqlite"),
        );
        const now = Date.parse("2026-05-28T00:00:00.000Z");
        try {
          database.exec("PRAGMA busy_timeout = 5000");
          database
            .query(\`
              insert into app_settings (
                id,
                translation_target_language,
                codex_translation_model,
                codex_translation_reasoning_effort,
                created_at,
                updated_at
              ) values (?, ?, ?, ?, ?, ?)
              on conflict(id) do update set
                translation_target_language = excluded.translation_target_language,
                codex_translation_model = excluded.codex_translation_model,
                codex_translation_reasoning_effort = excluded.codex_translation_reasoning_effort,
                updated_at = excluded.updated_at
            \`)
            .run(
              "default",
              "ja-JP",
              ${JSON.stringify(input.model)},
              ${JSON.stringify(input.reasoningEffort)},
              now,
              now,
            );
        } finally {
          database.close();
        }
  `);
}
