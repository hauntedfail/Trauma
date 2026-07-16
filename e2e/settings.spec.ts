import { expect, test } from "@playwright/test";

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
