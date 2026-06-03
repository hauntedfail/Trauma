import { expect, test, type Page } from "@playwright/test";

import { runBunFixtureScript } from "./bun-fixture";

const READER_MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f101";
const SECOND_READER_MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f102";
const TOC_SCROLL_MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f103";

test.describe.configure({ mode: "serial" });

test("renders a fixture memory in reader mode", async ({ page }) => {
  createReaderFixture();

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);

  await expect(page.getByText("Memory", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fixture Reader" })).toBeVisible();
  const detailsLink = page.getByRole("link", {
    exact: true,
    name: "Details",
  });
  await expect(detailsLink).toBeVisible();
  await expect(page.locator("#details")).toBeVisible();
  await detailsLink.click();
  await expect(page).toHaveURL(new RegExp(`/memories/${READER_MEMORY_ID}#details$`));
  await expect(page.locator("[data-reader-content]").getByText("Curated markdown body")).toBeVisible();
  await expect(page.locator("mark[data-flashback-id='flashback-fixture']")).toContainText(
    "saved flashback",
  );

  await page.evaluate((memoryId) => {
    const link = document.createElement("a");
    link.href = `/memories/${memoryId}`;
    link.textContent = "Open second reader fixture";
    document.body.append(link);
  }, SECOND_READER_MEMORY_ID);
  await page.getByRole("link", { name: "Open second reader fixture" }).click();

  await expect(page).toHaveURL(new RegExp(`/memories/${SECOND_READER_MEMORY_ID}$`));
  await expect(page.getByRole("heading", { name: "Second Fixture Reader" })).toBeVisible();
  await expect(page.getByText("Second reader body")).toBeVisible();
  await expect(page.getByText("Curated markdown body")).toHaveCount(0);
});

test("uses remembered translation defaults and cancels the popover on dismissal", async ({
  page,
}) => {
  createReaderFixture();
  seedReaderTranslationDefaults({
    model: "gpt-5.5",
    reasoningEffort: "high",
  });
  let translationStartCount = 0;
  await page.route("**/api/settings/codex-models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
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
  await page.route(
    `**/api/memories/${READER_MEMORY_ID}/translations`,
    async (route) => {
      translationStartCount += 1;
      await route.fulfill({
        contentType: "application/json",
        status: 200,
        body: JSON.stringify({
          status: "current",
          job_id: "job-current",
          memory_id: READER_MEMORY_ID,
          lang_code: "ja-JP",
          source_hash: "sha256:source",
          output_path: `memories/${READER_MEMORY_ID}/ja-JP/CONTENT.md`,
          reader_url: `/memories/${READER_MEMORY_ID}`,
        }),
      });
    },
  );
  await page.route("**/api/settings/translation-codex-defaults", async (route) => {
    const body = route.request().postDataJSON() as {
      model: string | null;
      reasoning_effort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | null;
    };
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({
        translationTargetLanguage: "ja-JP",
        codexTranslationModel: body.model,
        codexTranslationReasoningEffort: body.reasoning_effort,
        openaiAuth: {
          status: "enabled",
          provider: "codex",
          message: "Codex ChatGPT sign-in is enabled.",
        },
      }),
    });
  });

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  const trigger = page.getByRole("button", {
    name: "Translate memory",
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Translation settings" });
  const modelSelect = dialog.getByLabel("Model", { exact: true });
  const effortSelect = dialog.getByLabel("Reasoning effort", { exact: true });
  await expect(dialog).toBeVisible();
  await expect(modelSelect).toHaveValue("gpt-5.5");
  await expect(effortSelect).toHaveValue("high");

  await modelSelect.selectOption("gpt-5.3");
  await page.getByRole("heading", { name: "Fixture Reader" }).click();
  await expect(dialog).toHaveCount(0);
  expect(translationStartCount).toBe(0);

  await trigger.click();
  await expect(dialog).toBeVisible();
  await expect(modelSelect).toHaveValue("gpt-5.5");
  await expect(effortSelect).toHaveValue("high");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(translationStartCount).toBe(0);

  await trigger.click();
  await expect(dialog).toBeVisible();
  await modelSelect.selectOption("gpt-5.3");
  await effortSelect.selectOption("medium");
  const defaultsRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith("/api/settings/translation-codex-defaults") &&
      request.method() === "PATCH",
  );
  const translationRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith(`/api/memories/${READER_MEMORY_ID}/translations`) &&
      request.method() === "POST",
  );
  await dialog.getByRole("button", { name: "Translate" }).click();
  const [settingsRequest, request] = await Promise.all([
    defaultsRequest,
    translationRequest,
  ]);
  await expect(dialog).toHaveCount(0);
  expect(settingsRequest.postDataJSON()).toEqual({
    model: "gpt-5.3",
    reasoning_effort: "medium",
  });
  expect(request.postDataJSON()).toEqual({
    lang_code: "ja-JP",
    model: "gpt-5.3",
    reasoning_effort: "medium",
  });
});

test("deletes a memory from reader actions and returns to browse", async ({
  page,
}) => {
  createReaderFixture();

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await expect(page.getByRole("heading", { name: "Fixture Reader" })).toBeVisible();

  page.once("dialog", (dialog) => {
    expect(dialog.message()).toBe('Delete memory "Fixture Reader"?');
    void dialog.accept();
  });
  const deleteResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/memories/${READER_MEMORY_ID}`) &&
      response.request().method() === "DELETE",
  );
  await page
    .getByRole("button", { name: "Memory actions for Fixture Reader" })
    .click();
  await page.getByRole("menuitem", { name: "Delete memory" }).click();

  expect((await deleteResponse).status()).toBe(204);
  await expect(page).toHaveURL(/\/memories$/);
  await expect(page.getByText("Failed to delete memory.")).toHaveCount(0);

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await expect(page.getByRole("heading", { name: "Memory was not found." }))
    .toBeVisible();
});

test("keeps linked reader flashback anchors readable in non-normal themes", async ({
  page,
}) => {
  createReaderFixture();

  for (const theme of [
    { brightness: "sun", name: "warm-light", surface: "normal" },
    { brightness: "sun", name: "paper-warm-light", surface: "paper" },
    { brightness: "night", name: "paper-black-dark", surface: "paper" },
  ] as const) {
    await setReaderTheme(page, theme.brightness, theme.surface);
    await page.goto(`/memories/${READER_MEMORY_ID}#flashback-fixture`);
    await waitForReaderReady(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme.name);

    const targetStyle = await page.locator("mark#flashback-fixture").evaluate((mark) => {
      const style = getComputedStyle(mark);
      const rootStyle = getComputedStyle(document.documentElement);

      return {
        backgroundColor: style.backgroundColor,
        boxShadow: style.boxShadow,
        color: style.color,
        expectedBackground: rootStyle.getPropertyValue("--anchor-flashback-bg").trim(),
        expectedInk: rootStyle.getPropertyValue("--anchor-flashback-ink").trim(),
        expectedRing: rootStyle.getPropertyValue("--anchor-flashback-ring").trim(),
      };
    });

    expect(targetStyle.expectedBackground, theme.name).not.toBe("");
    expect(targetStyle.expectedInk, theme.name).not.toBe("");
    expect(targetStyle.expectedRing, theme.name).not.toBe("");
    expect(targetStyle.boxShadow, theme.name).not.toBe("none");
    expect(targetStyle.expectedBackground, theme.name).not.toBe("#ffe2a8");
    expect(targetStyle.expectedInk, theme.name).not.toBe("#3d2b12");
    expect(targetStyle.backgroundColor, theme.name).not.toBe("rgb(255, 226, 168)");
    expect(targetStyle.color, theme.name).not.toBe("rgb(61, 43, 18)");
  }
});

test("keeps sun reader links bright in normal and paper themes", async ({
  page,
}) => {
  createReaderFixture();

  for (const theme of [
    { brightness: "sun", name: "warm-light", surface: "normal" },
    { brightness: "sun", name: "paper-warm-light", surface: "paper" },
  ] as const) {
    await setReaderTheme(page, theme.brightness, theme.surface);
    await page.goto(`/memories/${READER_MEMORY_ID}`);
    await waitForReaderReady(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme.name);

    const sourceLinkColor = await page
      .getByRole("link", { name: "https://example.com/reader" })
      .evaluate((link) => getComputedStyle(link).color);
    const proseLinkColor = await page
      .getByRole("link", { name: "Reference link" })
      .evaluate((link) => getComputedStyle(link).color);
    const linkToken = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--link").trim(),
    );

    expect(linkToken, theme.name).toBe("#9a334a");
    expect(sourceLinkColor, theme.name).toBe("rgb(154, 51, 74)");
    expect(proseLinkColor, theme.name).toBe("rgb(154, 51, 74)");
  }
});

test("keeps a running psychiatrist turn alive across navigation, reload, and explicit Stop", async ({
  page,
}) => {
  createReaderFixture();
  const mock = await installPsychiatristMock(page);

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await installFakeEventSource(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();
  await expect(page.getByRole("region", { name: "Psychiatrist" })).toBeVisible();

  await page.locator("textarea").fill("What does this memory say?");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(page.getByText("Reading stored context")).toBeVisible();
  await expect(page.getByText("Partial answer from the memory")).toBeVisible();
  expect(mock.cancelRequests).toBe(0);
  expect(mock.startedRequests).toEqual([
    {
      message: "What does this memory say?",
      web_source_permission: "deny",
    },
  ]);

  await page.goto("/memories");
  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await installFakeEventSource(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(page.getByText("Partial answer from the memory")).toBeVisible();
  expect(mock.cancelRequests).toBe(0);

  await page.reload();
  await waitForReaderReady(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await expect(page.getByText("Partial answer from the memory")).toBeVisible();
  const eventSourceUrls = await page.evaluate(() =>
    ((window as unknown as { __psychiatristEventSourceUrls?: string[] })
      .__psychiatristEventSourceUrls ?? [])
  );
  expect(eventSourceUrls.some((url) => url.includes("turn-e2e-running"))).toBe(true);

  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  expect(mock.cancelRequests).toBe(1);
});

test("regenerates a psychiatrist answer in the same pair and preserves it after failed retry", async ({
  page,
}) => {
  createReaderFixture();
  const mock = await installPsychiatristMock(page, {
    initialPairs: [completedPsychiatristPair("Original answer from stored context.")],
  });

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await installFakeEventSource(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();
  await expect(page.getByText("Original answer from stored context.")).toBeVisible();

  await page.getByRole("button", { name: "Regenerate" }).click();
  await expect(page.getByText("Regenerated answer from the same pair.")).toBeVisible();
  await expect(page.getByText("Original answer from stored context.")).toHaveCount(0);
  expect(mock.regenerateRequests).toEqual([
    {
      pairId: "pair-e2e",
      web_source_permission: "deny",
    },
  ]);
  expect(mock.pairRevisionEvidence).toEqual({
    pair_id: "pair-e2e",
    response_path: "pairs/pair-e2e/RESPONSE.md",
    thread_id: "thread-e2e",
  });

  mock.failNextRegenerate = true;
  await expect(page.getByRole("button", { name: "Regenerate" })).toBeVisible();
  await page.getByRole("button", { name: "Regenerate" }).click();
  await expect(page.getByText("Psychiatrist could not finish. Retry when ready."))
    .toBeVisible();

  mock.stopNextRegenerate = true;
  await expect(page.getByRole("button", { name: "Regenerate" })).toBeVisible();
  await page.getByRole("button", { name: "Regenerate" }).click();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByText("Regenerated answer from the same pair.")).toBeVisible();
  expect(mock.stoppedRegenerateEvidence).toEqual({
    pair_id: "pair-e2e",
    response_path: "pairs/pair-e2e/RESPONSE.md",
    thread_id: "thread-e2e",
  });

  await page.reload();
  await waitForReaderReady(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();
  await expect(page.getByText("Regenerated answer from the same pair.")).toBeVisible();
  expect(mock.regenerateRequests.map((request) => request.pairId)).toEqual([
    "pair-e2e",
    "pair-e2e",
    "pair-e2e",
  ]);
});

test("requires per-turn psychiatrist web-source approval before recording source policy", async ({
  page,
}) => {
  createReaderFixture();
  const mock = await installPsychiatristMock(page);

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();
  await page.locator("textarea").fill("Use current web sources for this memory.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Allow web search/source lookup for this answer to continue."))
    .toBeVisible();
  await expect(page.getByRole("button", { name: "Allow web sources for this turn" }))
    .toBeVisible();
  expect(mock.networkEnabledBeforeApproval).toBe(false);

  await page.getByRole("button", { name: "Allow web sources for this turn" }).click();
  await expect(page.getByText("Approved answer with cited source.")).toBeVisible();
  expect(mock.approvedWebSourceEvidence).toEqual({
    source_citations: [
      {
        source_id: "source-e2e",
        title: "Example source",
        url: "https://example.com/source",
      },
    ],
    web_source_policy: {
      allowed: true,
      reason: "user_approved_for_turn",
    },
  });
});

interface PsychiatristMockState {
  approvedWebSourceEvidence?: {
    source_citations: Array<{
      source_id: string;
      title: string;
      url: string;
    }>;
    web_source_policy: {
      allowed: boolean;
      reason: string;
    };
  };
  cancelRequests: number;
  eventTurnRequests: string[];
  failNextRegenerate: boolean;
  networkEnabledBeforeApproval: boolean;
  pairRevisionEvidence?: {
    pair_id: string;
    response_path: string;
    thread_id: string;
  };
  regenerateRequests: Array<{
    pairId: string;
    web_source_permission: string;
  }>;
  startedRequests: Array<{
    message: string;
    web_source_permission: string;
  }>;
  stopNextRegenerate: boolean;
  stoppedRegenerateEvidence?: {
    pair_id: string;
    response_path: string;
    thread_id: string;
  };
}

interface PsychiatristPairFixture {
  assistant_response?: {
    completed_at: string;
    content: string;
    source_citations: Array<{
      source_id: string;
      title: string;
      url: string;
    }>;
  };
  pair_id: string;
  status: "pending" | "completed" | "failed" | "canceled" | "stale";
  turn_id: string;
  user_prompt: {
    content: string;
    created_at: string;
  };
}

async function installPsychiatristMock(
  page: Page,
  input: {
    initialPairs?: PsychiatristPairFixture[];
  } = {},
): Promise<PsychiatristMockState> {
  await page.addInitScript(installFakeEventSourceInBrowser);

  const state: PsychiatristMockState = {
    cancelRequests: 0,
    eventTurnRequests: [],
    failNextRegenerate: false,
    networkEnabledBeforeApproval: false,
    regenerateRequests: [],
    stopNextRegenerate: false,
    startedRequests: [],
  };
  let activeTurn: { pair_id: string; turn_id: string } | null = null;
  let pairs = [...(input.initialPairs ?? [])];

  await page.route(`**/api/memories/${READER_MEMORY_ID}/psychiatrist/threads`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        active_turn: activeTurn === null
          ? null
          : {
              event_url: `/api/psychiatrist-turns/${activeTurn.turn_id}/events`,
              pair_id: activeTurn.pair_id,
              status: "running",
              turn_id: activeTurn.turn_id,
            },
        content_hash: "sha256:e2e-reader",
        lang_code: null,
        memory_id: READER_MEMORY_ID,
        pairs,
        status: activeTurn === null ? "ready" : "running",
        thread_id: "thread-e2e",
        variant_kind: "source",
      }),
    });
  });

  await page.route("**/api/psychiatrist-threads/thread-e2e/messages", async (route) => {
    const body = route.request().postDataJSON() as {
      message: string;
      web_source_permission: string;
    };
    state.startedRequests.push({
      message: body.message,
      web_source_permission: body.web_source_permission,
    });

    if (
      body.message.includes("current web sources") &&
      body.web_source_permission !== "allow_for_this_turn"
    ) {
      await route.fulfill({
        contentType: "application/json",
        status: 409,
        body: JSON.stringify({
          action: "allow_web_sources",
          code: "network_permission_required",
          message: "Web sources require approval.",
          status: "error",
        }),
      });
      return;
    }

    if (body.web_source_permission === "allow_for_this_turn") {
      activeTurn = { pair_id: "pair-e2e-web", turn_id: "turn-e2e-web" };
      state.approvedWebSourceEvidence = {
        source_citations: [
          {
            source_id: "source-e2e",
            title: "Example source",
            url: "https://example.com/source",
          },
        ],
        web_source_policy: {
          allowed: true,
          reason: "user_approved_for_turn",
        },
      };
    } else {
      state.networkEnabledBeforeApproval ||= body.web_source_permission ===
        "allow_for_this_turn";
      activeTurn = { pair_id: "pair-e2e-running", turn_id: "turn-e2e-running" };
    }

    pairs = [
      ...pairs,
      {
        pair_id: activeTurn.pair_id,
        status: "pending",
        turn_id: activeTurn.turn_id,
        user_prompt: {
          content: body.message,
          created_at: "2026-06-03T00:00:00.000Z",
        },
      },
    ];

    await route.fulfill({
      contentType: "application/json",
      status: 202,
      body: JSON.stringify(startedResponse(activeTurn.pair_id, activeTurn.turn_id)),
    });
  });

  await page.route("**/api/psychiatrist-pairs/*/regenerate", async (route) => {
    const pairId = route.request().url().match(/\/psychiatrist-pairs\/([^/]+)\/regenerate/)?.[1] ??
      "";
    const body = route.request().postDataJSON() as {
      web_source_permission: string;
    };
    state.regenerateRequests.push({
      pairId,
      web_source_permission: body.web_source_permission,
    });

    if (state.failNextRegenerate) {
      state.failNextRegenerate = false;
      await route.fulfill({
        contentType: "application/json",
        status: 500,
        body: JSON.stringify({
          action: "retry",
          code: "timeout",
          message: "Regenerate timed out.",
          status: "error",
        }),
      });
      return;
    }

    activeTurn = {
      pair_id: pairId,
      turn_id: state.stopNextRegenerate
        ? "turn-e2e-regenerate-stopped"
        : "turn-e2e-regenerate",
    };
    if (state.stopNextRegenerate) {
      state.stopNextRegenerate = false;
      state.stoppedRegenerateEvidence = {
        pair_id: pairId,
        response_path: `pairs/${pairId}/RESPONSE.md`,
        thread_id: "thread-e2e",
      };
    }
    state.pairRevisionEvidence = {
      pair_id: pairId,
      response_path: `pairs/${pairId}/RESPONSE.md`,
      thread_id: "thread-e2e",
    };
    await route.fulfill({
      contentType: "application/json",
      status: 202,
      body: JSON.stringify(startedResponse(pairId, activeTurn.turn_id)),
    });
  });

  await page.route("**/api/psychiatrist-turns/*/cancel", async (route) => {
    state.cancelRequests += 1;
    if (activeTurn?.turn_id === "turn-e2e-regenerate-stopped") {
      pairs = pairs.map((pair) =>
        pair.pair_id === "pair-e2e"
          ? completedPsychiatristPair("Regenerated answer from the same pair.")
          : pair
      );
    }
    activeTurn = null;
    await route.fulfill({ status: 204 });
  });

  await page.route("**/api/psychiatrist-turns/*/events", async (route) => {
    const turnId = route.request().url().match(/\/psychiatrist-turns\/([^/]+)\/events/)?.[1] ??
      "";
    state.eventTurnRequests.push(turnId);
    await route.fulfill({
      contentType: "text/event-stream",
      body: psychiatristSse(turnId),
    });
    if (turnId === "turn-e2e-regenerate") {
      activeTurn = null;
      pairs = pairs.map((pair) =>
        pair.pair_id === "pair-e2e"
          ? completedPsychiatristPair("Regenerated answer from the same pair.")
          : pair
      );
    }
    if (turnId === "turn-e2e-web") {
      activeTurn = null;
      pairs = pairs.map((pair) =>
        pair.pair_id === "pair-e2e-web"
          ? {
              ...pair,
              assistant_response: {
                completed_at: "2026-06-03T00:00:02.000Z",
                content: "Approved answer with cited source.",
                source_citations: state.approvedWebSourceEvidence?.source_citations ?? [],
              },
              status: "completed",
            }
          : pair
      );
    }
  });

  return state;
}

async function installFakeEventSource(page: Page) {
  await page.evaluate(installFakeEventSourceInBrowser);
}

function installFakeEventSourceInBrowser() {
    const eventData = (type: string, turnId: string, eventId: string, data: Record<string, unknown>) =>
      JSON.stringify({
        data,
        eventId,
        memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f101",
        threadId: "thread-e2e",
        timestamp: Date.parse("2026-06-03T00:00:00.000Z"),
        turnId,
        type,
      });
    const eventsFor = (url: string): Array<[string, string]> => {
      if (url.includes("turn-e2e-regenerate")) {
        if (url.includes("turn-e2e-regenerate-stopped")) {
          return [
            ["psychiatrist.regenerate.started", eventData("psychiatrist.regenerate.started", "turn-e2e-regenerate-stopped", "001", { pair_id: "pair-e2e" })],
          ];
        }
        return [
          ["psychiatrist.regenerate.started", eventData("psychiatrist.regenerate.started", "turn-e2e-regenerate", "001", { pair_id: "pair-e2e" })],
          ["psychiatrist.answer.delta", eventData("psychiatrist.answer.delta", "turn-e2e-regenerate", "002", { pair_id: "pair-e2e", text: "Regenerated answer from the same pair." })],
          ["psychiatrist.regenerate.completed", eventData("psychiatrist.regenerate.completed", "turn-e2e-regenerate", "003", { pair_id: "pair-e2e", text: "Regenerated answer from the same pair." })],
        ];
      }
      if (url.includes("turn-e2e-web")) {
        return [
          ["psychiatrist.turn.started", eventData("psychiatrist.turn.started", "turn-e2e-web", "000", { pair_id: "pair-e2e-web", user_prompt: "Use current web sources for this memory." })],
          ["psychiatrist.answer.delta", eventData("psychiatrist.answer.delta", "turn-e2e-web", "001", { pair_id: "pair-e2e-web", text: "Approved answer with cited source." })],
          ["psychiatrist.answer.completed", eventData("psychiatrist.answer.completed", "turn-e2e-web", "002", { pair_id: "pair-e2e-web", text: "Approved answer with cited source." })],
        ];
      }
      return [
        ["psychiatrist.turn.started", eventData("psychiatrist.turn.started", "turn-e2e-running", "000", { pair_id: "pair-e2e-running", user_prompt: "What does this memory say?" })],
        ["psychiatrist.process.delta", eventData("psychiatrist.process.delta", "turn-e2e-running", "001", { pair_id: "pair-e2e-running", text: "Reading stored context" })],
        ["psychiatrist.answer.delta", eventData("psychiatrist.answer.delta", "turn-e2e-running", "002", { pair_id: "pair-e2e-running", text: "Partial answer from the memory" })],
      ];
    };
    class FakeEventSource extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;
      readyState = FakeEventSource.CONNECTING;
      url: string;

      constructor(url: string) {
        super();
        this.url = url;
        const global = window as unknown as { __psychiatristEventSourceUrls?: string[] };
        global.__psychiatristEventSourceUrls = [
          ...(global.__psychiatristEventSourceUrls ?? []),
          url,
        ];
        setTimeout(() => this.connect(), 0);
      }

      close() {
        this.readyState = FakeEventSource.CLOSED;
      }

      private connect() {
        if (this.readyState === FakeEventSource.CLOSED) {
          return;
        }
        this.readyState = FakeEventSource.OPEN;
        for (const [type, data] of eventsFor(this.url)) {
          if (this.readyState === FakeEventSource.CLOSED) {
            return;
          }
          this.dispatchEvent(new MessageEvent(type, { data }));
        }
      }
    }

    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: FakeEventSource,
    });
}

function completedPsychiatristPair(content: string): PsychiatristPairFixture {
  return {
    assistant_response: {
      completed_at: "2026-06-03T00:00:00.000Z",
      content,
      source_citations: [],
    },
    pair_id: "pair-e2e",
    status: "completed",
    turn_id: "turn-e2e-completed",
    user_prompt: {
      content: "What does this memory say?",
      created_at: "2026-06-03T00:00:00.000Z",
    },
  };
}

function startedResponse(pairId: string, turnId: string) {
  return {
    event_url: `/api/psychiatrist-turns/${turnId}/events`,
    pair_id: pairId,
    replay_url: `/api/psychiatrist-turns/${turnId}/events`,
    status: "started",
    thread_id: "thread-e2e",
    turn_id: turnId,
  };
}

function psychiatristSse(turnId: string): string {
  if (turnId === "turn-e2e-regenerate") {
    return [
      sseEvent("psychiatrist.regenerate.started", turnId, "001", {}),
      sseEvent("psychiatrist.answer.delta", turnId, "002", {
        text: "Regenerated answer from the same pair.",
        pair_id: "pair-e2e",
      }),
      sseEvent("psychiatrist.regenerate.completed", turnId, "003", {
        text: "Regenerated answer from the same pair.",
        pair_id: "pair-e2e",
      }),
    ].join("");
  }
  if (turnId === "turn-e2e-web") {
    return [
      sseEvent("psychiatrist.turn.started", turnId, "000", {
        pair_id: "pair-e2e-web",
        user_prompt: "Use current web sources for this memory.",
      }),
      sseEvent("psychiatrist.answer.delta", turnId, "001", {
        text: "Approved answer with cited source.",
        pair_id: "pair-e2e-web",
      }),
      sseEvent("psychiatrist.answer.completed", turnId, "002", {
        text: "Approved answer with cited source.",
        pair_id: "pair-e2e-web",
      }),
    ].join("");
  }
  return [
    sseEvent("psychiatrist.turn.started", turnId, "000", {
      pair_id: "pair-e2e-running",
      user_prompt: "What does this memory say?",
    }),
    sseEvent("psychiatrist.process.delta", turnId, "001", {
      text: "Reading stored context",
      pair_id: "pair-e2e-running",
    }),
    sseEvent("psychiatrist.answer.delta", turnId, "002", {
      text: "Partial answer from the memory",
      pair_id: "pair-e2e-running",
    }),
  ].join("");
}

function sseEvent(
  type: string,
  turnId: string,
  eventId: string,
  data: Record<string, unknown>,
): string {
  return [
    `event: ${type}`,
    `id: ${eventId}`,
    `data: ${JSON.stringify({
      data,
      eventId,
      memoryId: READER_MEMORY_ID,
      threadId: "thread-e2e",
      timestamp: Date.parse("2026-06-03T00:00:00.000Z"),
      turnId,
      type,
    })}`,
    "",
    "",
  ].join("\n");
}

test("toggles selected reader text as a persisted flashback", async ({ page }) => {
  createReaderFixture();
  const selectedText = "Curated markdown body";

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);

  const createResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/flashbacks") &&
      response.request().method() === "POST",
  );
  await selectReaderText(page, selectedText);
  await page.getByRole("button", { name: "Flashback selection" }).click();
  await expect(
    page.locator("mark[data-flashback-id]", { hasText: selectedText }),
  ).toBeVisible();
  expect((await createResponse).ok()).toBe(true);

  await page.reload();
  await waitForReaderReady(page);
  await expect(
    page.locator("mark[data-flashback-id]", { hasText: selectedText }),
  ).toBeVisible();

  const removeResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/flashbacks") &&
      response.request().method() === "POST",
  );
  await selectReaderText(page, selectedText);
  await page.getByRole("button", { name: "Flashback selection" }).click();
  await expect(
    page.locator("mark[data-flashback-id]", { hasText: selectedText }),
  ).toHaveCount(0);
  expect((await removeResponse).ok()).toBe(true);

  await page.reload();
  await waitForReaderReady(page);
  await expect(
    page.locator("mark[data-flashback-id]", { hasText: selectedText }),
  ).toHaveCount(0);
  await expect(page.locator("[data-reader-content]").getByText(selectedText)).toBeVisible();
});

test("creates a Moment from a right-rail table of contents button", async ({
  page,
}) => {
  createReaderFixture();

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);

  const createResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/moments") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("navigation", { name: "Table of contents" })
    .getByRole("button", { name: "Moment Details" })
    .click();

  const response = await createResponse;
  expect(response.status(), await response.text()).toBe(201);
  await expect(
    page
      .getByRole("navigation", { name: "Table of contents" })
      .getByRole("button", { name: "Moment Details" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(readMomentAnchors()).toContain("details");
});

test("toggles a Moment off from the right-rail table of contents button", async ({
  page,
}) => {
  createReaderFixture();

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);

  const tocButton = page
    .getByRole("navigation", { name: "Table of contents" })
    .getByRole("button", { name: "Moment Details" });
  const createResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/moments") &&
      response.request().method() === "POST",
  );
  await tocButton.click();
  expect((await createResponse).status()).toBe(201);
  await expect(tocButton).toHaveAttribute("aria-pressed", "true");
  expect(readMomentAnchors()).toContain("details");

  const deleteResponse = page.waitForResponse(
    (response) =>
      /\/api\/moments\/[^/]+$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "DELETE",
    { timeout: 3_000 },
  );
  await tocButton.click();
  expect((await deleteResponse).status()).toBe(204);
  await expect(tocButton).toHaveAttribute("aria-pressed", "false");
  expect(readMomentAnchors()).not.toContain("details");
});

test("creates a Moment from a reader heading affordance button", async ({
  page,
}) => {
  createReaderFixture();

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);

  const createResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/moments") &&
      response.request().method() === "POST",
  );
  await page
    .locator("[data-reader-content]")
    .getByRole("button", { name: "Moment Details" })
    .click();

  const response = await createResponse;
  expect(response.status(), await response.text()).toBe(201);
  expect(readMomentAnchors()).toContain("details");
});

test("opens Moment rows at the reader section and deletes from the Moments menu", async ({
  page,
}) => {
  createReaderFixture();
  await page.setViewportSize({ width: 1440, height: 700 });

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  const createResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/moments") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("navigation", { name: "Table of contents" })
    .getByRole("button", { name: "Moment Details" })
    .click();
  expect((await createResponse).status()).toBe(201);
  expect(readMomentAnchors()).toContain("details");

  await page.goto("/moments");
  await page.getByRole("link", { name: /Fixture Reader.*Details/s }).click();
  await expect(page).toHaveURL(new RegExp(`/memories/${READER_MEMORY_ID}#details$`));
  await expectReaderTargetNearTop(page, "#details");

  await page.goto("/moments");
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toBe('Delete moment "Details"?');
    void dialog.accept();
  });
  const deleteResponse = page.waitForResponse(
    (response) =>
      /\/api\/moments\/[^/]+$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "DELETE",
  );
  await page.getByRole("button", { name: "Moment actions for Details" }).click();
  await page.getByRole("menuitem", { name: "Delete moment" }).click();

  expect((await deleteResponse).status()).toBe(204);
  await expect(page.getByRole("heading", { name: "Details" })).toHaveCount(0);
  expect(readMomentAnchors()).not.toContain("details");
});

test("opens reader right-rail Flashback shortcuts at the reader flashback mark", async ({
  page,
}) => {
  createReaderFixture();
  await page.setViewportSize({ width: 1440, height: 700 });

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await page
    .getByRole("complementary", { name: "Browse filters" })
    .getByRole("link", { name: /deep saved flashback/i })
    .click();

  await expect(page).toHaveURL(
    new RegExp(`/memories/${READER_MEMORY_ID}#flashback-deep$`),
  );
  await expectReaderTargetNearTop(page, "#flashback-deep");
});

test("creates a Moment from the selection menu when the range contains a section", async ({
  page,
}) => {
  createReaderFixture();

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await selectReaderSection(page, "details");

  const menu = page.getByRole("menu", {
    name: "Reader text selection actions",
  });
  await expect(
    menu.getByRole("button", { name: "Moment selected section" }),
  ).toBeVisible();

  const createResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/moments") &&
      response.request().method() === "POST",
  );
  await menu.getByRole("button", { name: "Moment selected section" }).click();

  const response = await createResponse;
  expect(response.status(), await response.text()).toBe(201);
  expect(readMomentAnchors()).toContain("details");
});

test("shows reader toc scroll blur fades only for available scroll directions", async ({
  page,
}) => {
  createReaderFixture();
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto(`/memories/${TOC_SCROLL_MEMORY_ID}`);
  await waitForReaderReady(page);

  const toc = page.getByRole("navigation", { name: "Table of contents" });
  await expect(toc).toBeVisible();

  const topFade = toc.locator(".trauma-toc-scroll-fade-top");
  const bottomFade = toc.locator(".trauma-toc-scroll-fade-bottom");
  await expect(topFade).toHaveCount(0);
  await expect(bottomFade).toBeVisible();

  const geometry = await toc.evaluate((nav) => {
    const bottomFadeElement = nav.querySelector(".trauma-toc-scroll-fade-bottom");
    const listElement = nav.querySelector("ol");

    if (
      !(bottomFadeElement instanceof HTMLElement) ||
      !(listElement instanceof HTMLElement)
    ) {
      throw new Error("TOC bottom fade or list element is missing");
    }

    const navRect = nav.getBoundingClientRect();
    const bottomFadeRect = bottomFadeElement.getBoundingClientRect();
    const bottomFadeStyle = getComputedStyle(bottomFadeElement);

    return {
      listClientHeight: listElement.clientHeight,
      listScrollHeight: listElement.scrollHeight,
      bottomFadeBottomGap: Number(
        (navRect.bottom - bottomFadeRect.bottom).toFixed(2),
      ),
      bottomFadeBackdropFilter: bottomFadeStyle.backdropFilter,
      bottomFadeBoxShadow: bottomFadeStyle.boxShadow,
    };
  });

  expect(geometry.listScrollHeight).toBeGreaterThan(geometry.listClientHeight);
  expect(Math.abs(geometry.bottomFadeBottomGap)).toBeLessThanOrEqual(1);
  expect(geometry.bottomFadeBackdropFilter).toContain("blur(");
  expect(geometry.bottomFadeBoxShadow).toBe("none");

  await toc.locator("ol").evaluate((list) => {
    list.scrollTop = Math.floor(list.scrollHeight / 2);
    list.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await expect(topFade).toBeVisible();
  await expect(bottomFade).toBeVisible();

  const topFadeGeometry = await toc.evaluate((nav) => {
    const topFadeElement = nav.querySelector(".trauma-toc-scroll-fade-top");
    const listElement = nav.querySelector("ol");

    if (
      !(topFadeElement instanceof HTMLElement) ||
      !(listElement instanceof HTMLElement)
    ) {
      throw new Error("TOC top fade or list element is missing");
    }

    const topFadeRect = topFadeElement.getBoundingClientRect();
    const listRect = listElement.getBoundingClientRect();
    const topFadeStyle = getComputedStyle(topFadeElement);

    return {
      topFadeTopGap: Number((topFadeRect.top - listRect.top).toFixed(2)),
      topFadeMaskImage:
        topFadeStyle.getPropertyValue("mask-image") ||
        topFadeStyle.getPropertyValue("-webkit-mask-image"),
    };
  });

  expect(Math.abs(topFadeGeometry.topFadeTopGap)).toBeLessThanOrEqual(1);
  expect(topFadeGeometry.topFadeMaskImage).toContain("linear-gradient");

  await toc.locator("ol").evaluate((list) => {
    list.scrollTop = list.scrollHeight;
    list.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await expect(topFade).toBeVisible();
  await expect(bottomFade).toHaveCount(0);
});

async function setReaderTheme(
  page: Page,
  brightness: "night" | "sun",
  surface: "normal" | "paper",
) {
  await page.goto("/memories");
  await page.evaluate(
    ({ brightness: nextBrightness, surface: nextSurface }) => {
      localStorage.setItem("trauma:brightness", nextBrightness);
      localStorage.setItem("trauma:surface", nextSurface);
    },
    { brightness, surface },
  );
}

function createReaderFixture() {
  runBunFixtureScript(`
        import { mkdir, rm, writeFile } from "node:fs/promises";
        import { dirname, join } from "node:path";
        import { schema } from "./src/server/db/index.ts";
        import { initializeDatabase } from "./src/server/db/connection.ts";
        import { writeMemoryContent } from "./src/server/store/index.ts";

        const configPath = join(process.cwd(), ".trauma/e2e/trauma.config.json");
        const memoryId = "${READER_MEMORY_ID}";
        const secondMemoryId = "${SECOND_READER_MEMORY_ID}";
        const tocScrollMemoryId = "${TOC_SCROLL_MEMORY_ID}";
        const config = {
          storePath: "./project/store",
          projectPath: "./project",
          databasePath: "./runtime/trauma.sqlite",
          backup: {
            git: {
              enabled: false,
              remote: "origin",
              branch: "main",
              push: false,
              commitMessageTemplate: "backup memory {memoryId}",
            },
          },
        };
        const resolvedConfig = {
          configFilePath: configPath,
          projectPath: join(process.cwd(), ".trauma/e2e/project"),
          storePath: join(process.cwd(), ".trauma/e2e/project/store"),
          databasePath: join(process.cwd(), ".trauma/e2e/runtime/trauma.sqlite"),
          backup: config.backup,
        };
        const readerMarkdown = [
          "# Fixture Reader",
          "",
          "Curated markdown body with saved flashback.",
          "",
          "A [Reference link](https://example.com/reference) belongs to the reader content.",
          "",
          ...Array.from({ length: 16 }, (_, index) => [
            \`Reader spacer paragraph \${index + 1} keeps lower anchors below the first viewport.\`,
            "",
          ]).flat(),
          "## Details",
          "",
          "Details section keeps deep saved flashback in the lower reader body.",
          "",
          "| Kind | Value |",
          "| --- | --- |",
          "| reader | smoke |",
          "",
          ...Array.from({ length: 16 }, (_, index) => [
            \`Reader trailing paragraph \${index + 1} keeps anchored sections scrollable to the top.\`,
            "",
          ]).flat(),
        ].join("\\n");

        await rm(join(process.cwd(), ".trauma/e2e"), { recursive: true, force: true });
        await mkdir(dirname(configPath), { recursive: true });
        await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");

        async function insertMemory(memoryId, title, url) {
          await connection.db.insert(schema.memories).values({
            id: memoryId,
            url,
            title,
            description: "Reader fixture",
            faviconUrl: null,
            contentPath: \`memories/\${memoryId}/CONTENT.md\`,
            extractionStatus: "success",
            extractionError: null,
            backupStatus: "disabled",
            lastBackupAt: null,
            lastBackupError: null,
            createdAt: new Date("2026-05-09T00:00:00.000Z"),
            updatedAt: new Date("2026-05-09T00:00:00.000Z"),
          });
        }

        const connection = initializeDatabase(resolvedConfig);
        try {
          await insertMemory(memoryId, "Fixture Reader", "https://example.com/reader");
          await insertMemory(secondMemoryId, "Second Fixture Reader", "https://example.com/second-reader");
          await insertMemory(tocScrollMemoryId, "Long Contents Fixture", "https://example.com/long-contents");
          const flashbackStartOffset = readerMarkdown.indexOf("saved flashback");
          const deepFlashbackStartOffset = readerMarkdown.indexOf("deep saved flashback");
          await connection.db.insert(schema.flashbacks).values([
            {
              id: "flashback-fixture",
              memoryId,
              text: "saved flashback",
              prefix: "Curated markdown body with ",
              suffix: ".",
              startOffset: flashbackStartOffset,
              endOffset: flashbackStartOffset + "saved flashback".length,
              createdAt: new Date("2026-05-09T00:00:00.000Z"),
              updatedAt: new Date("2026-05-09T00:00:00.000Z"),
            },
            {
              id: "flashback-deep",
              memoryId,
              text: "deep saved flashback",
              prefix: "Details section keeps ",
              suffix: " in the lower reader body.",
              startOffset: deepFlashbackStartOffset,
              endOffset: deepFlashbackStartOffset + "deep saved flashback".length,
              createdAt: new Date("2026-05-09T00:01:00.000Z"),
              updatedAt: new Date("2026-05-09T00:01:00.000Z"),
            },
          ]);
        } finally {
          connection.close();
        }

        async function writeFixtureContent(memoryId, title, url, markdown) {
          await writeMemoryContent({
            config: resolvedConfig,
            memoryId,
            frontmatter: {
              id: memoryId,
              url,
              title,
              capturedAt: "2026-05-09T00:00:00.000Z",
              extractionStatus: "success",
            },
            markdown,
          });
        }

        await writeFixtureContent(
          memoryId,
          "Fixture Reader",
          "https://example.com/reader",
          readerMarkdown,
        );
        await writeFixtureContent(
          secondMemoryId,
          "Second Fixture Reader",
          "https://example.com/second-reader",
          [
            "# Second Fixture Reader",
            "",
            "Second reader body.",
            "",
            "## Follow Up",
            "",
            "Ready-to-ready navigation should replace the rendered article.",
          ].join("\\n"),
        );
        await writeFixtureContent(
          tocScrollMemoryId,
          "Long Contents Fixture",
          "https://example.com/long-contents",
          [
            "# Long Contents Fixture",
            "",
            "This reader exists to make the right-rail table of contents overflow.",
            "",
            ...Array.from({ length: 48 }, (_, index) => [
              \`## Section \${index + 1}\`,
              "",
              \`Body \${index + 1}.\`,
            ]).flat(),
          ].join("\\n"),
        );
  `);
}

function seedReaderTranslationDefaults(input: {
  model: string | null;
  reasoningEffort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | null;
}) {
  runBunFixtureScript(`
        import { Database } from "bun:sqlite";
        import { join } from "node:path";

        const database = new Database(
          join(process.cwd(), ".trauma/e2e/runtime/trauma.sqlite"),
        );
        const now = Date.parse("2026-05-28T00:00:00.000Z");
        try {
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

function readMomentAnchors(): string[] {
  const stdout = runBunFixtureScript(`
        import { Database } from "bun:sqlite";
        import { join } from "node:path";

        const database = new Database(
          join(process.cwd(), ".trauma/e2e/runtime/trauma.sqlite"),
          { readonly: true },
        );
        try {
          const rows = database
            .query("select section_anchor from moments order by created_at asc")
            .all();
          console.log(JSON.stringify(rows.map((row) => row.section_anchor)));
        } finally {
          database.close();
        }
  `);

  return JSON.parse(stdout.trim()) as string[];
}

async function waitForReaderReady(page: Page) {
  await expect(page.locator("[data-reader-content]")).toHaveAttribute(
    "data-reader-ready",
    "true",
  );
}

async function selectReaderText(page: Page, text: string) {
  await waitForReaderReady(page);
  await page.locator("[data-reader-content]").evaluate((root, selectedText) => {
    const findTextNode = (node: Node): Text | undefined => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      let current = walker.nextNode();
      while (current !== null) {
        if (current.nodeValue?.includes(selectedText)) {
          return current as Text;
        }

        current = walker.nextNode();
      }

      return undefined;
    };
    const textNode = findTextNode(root);
    if (textNode === undefined) {
      throw new Error(`Text not found: ${selectedText}`);
    }

    const startOffset = textNode.nodeValue?.indexOf(selectedText) ?? -1;
    if (startOffset < 0) {
      throw new Error(`Text node did not contain: ${selectedText}`);
    }

    const range = document.createRange();
    range.setStart(textNode, startOffset);
    range.setEnd(textNode, startOffset + selectedText.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, text);
}

async function selectReaderSection(page: Page, anchor: string) {
  await waitForReaderReady(page);
  await page.locator("[data-reader-content]").evaluate(async (root, sectionAnchor) => {
    const section = root.querySelector<HTMLElement>(
      `[data-reader-section-anchor="${sectionAnchor}"]`,
    );
    if (section === null) {
      throw new Error(`Section not found: ${sectionAnchor}`);
    }

    section.scrollIntoView({
      block: "center",
      inline: "nearest",
    });
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    const range = document.createRange();
    range.selectNode(section);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  }, anchor);
}

async function expectReaderTargetNearTop(page: Page, selector: string) {
  await expect(page.locator(selector)).toBeVisible();
  await expect
    .poll(async () =>
      page.locator(selector).evaluate((target) =>
        Math.round(target.getBoundingClientRect().top),
      ),
    )
    .toBeLessThan(160);
}
