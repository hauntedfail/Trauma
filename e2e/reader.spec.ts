import { createServer, type Server, type ServerResponse } from "node:http";

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
  let translationDefaultsRequestCount = 0;
  let releaseTranslationDefaults: () => void = () => undefined;
  const translationDefaultsGate = new Promise<void>((resolve) => {
    releaseTranslationDefaults = resolve;
  });
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
  await page.route("**/api/settings/translation-defaults", async (route) => {
    translationDefaultsRequestCount += 1;
    const body = route.request().postDataJSON() as {
      language: string;
      model: string | null;
      reasoning_effort: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | null;
    };
    await translationDefaultsGate;
    await route.fulfill({
      contentType: "application/json",
      status: 200,
      body: JSON.stringify({
        translationTargetLanguage: body.language,
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
      request.url().endsWith("/api/settings/translation-defaults") &&
      request.method() === "PATCH",
  );
  const translationRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith(`/api/memories/${READER_MEMORY_ID}/translations`) &&
      request.method() === "POST",
  );
  const translateButton = dialog.getByRole("button", { name: "Translate" });
  await translateButton.click();
  await expect.poll(() => translationDefaultsRequestCount).toBe(1);
  await expect(translateButton).toBeDisabled();
  await dialog.locator("form").evaluate((form) => {
    form.dispatchEvent(new SubmitEvent("submit", {
      bubbles: true,
      cancelable: true,
    }));
  });
  await page.waitForTimeout(50);
  expect(translationDefaultsRequestCount).toBe(1);
  releaseTranslationDefaults();
  const [settingsRequest, request] = await Promise.all([
    defaultsRequest,
    translationRequest,
  ]);
  await expect(dialog).toHaveCount(0);
  expect(settingsRequest.postDataJSON()).toEqual({
    language: "ja-JP",
    model: "gpt-5.3",
    reasoning_effort: "medium",
  });
  expect(request.postDataJSON()).toEqual({
    lang_code: "ja-JP",
    model: "gpt-5.3",
    reasoning_effort: "medium",
  });
  expect(translationStartCount).toBe(1);
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

test("keeps the psychiatrist dock clear and named across phone and desktop layouts", async ({
  page,
}) => {
  createReaderFixture();
  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);

  for (const viewport of [
    { height: 844, kind: "phone", width: 390 },
    { height: 900, kind: "phone", width: 700 },
    { height: 900, kind: "desktop", width: 1041 },
  ] as const) {
    await page.setViewportSize({
      height: viewport.height,
      width: viewport.width,
    });

    const dock = page.locator(".trauma-psychiatrist-dock");
    const bottomOffset = await dock.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return window.innerHeight - box.bottom;
    });

    if (viewport.kind === "phone") {
      const primaryTabs = page.getByRole("navigation", { name: "Primary tabs" });
      await expect(primaryTabs).toBeVisible();
      const [dockBox, tabBox] = await Promise.all([
        dock.boundingBox(),
        primaryTabs.boundingBox(),
      ]);

      expect(bottomOffset).toBeCloseTo(76, 0);
      expect(dockBox).not.toBeNull();
      expect(tabBox).not.toBeNull();
      expect(dockBox!.y + dockBox!.height).toBeLessThanOrEqual(tabBox!.y);
    } else {
      await expect(page.getByRole("navigation", { name: "Primary tabs" })).toBeHidden();
      expect(bottomOffset).toBeCloseTo(24, 0);
    }
  }

  await page.getByRole("button", { name: "Open Psychiatrist" }).click();
  await expect(
    page.getByRole("textbox", { name: "Message Psychiatrist" }),
  ).toBeVisible();
});

test("closes the topmost reader popup before the psychiatrist dock on Escape", async ({
  page,
}) => {
  createReaderFixture();
  await installPsychiatristMock(page);
  await page.route("**/api/settings/codex-models", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ models: [] }),
    });
  });

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);

  const dockTrigger = page.getByRole("button", { name: "Open Psychiatrist" });
  await dockTrigger.click();
  const dock = page.getByRole("region", { name: "Psychiatrist" });
  await expect(dock).toBeVisible();

  const translationTrigger = page.getByRole("button", {
    name: "Translate memory",
  });
  await translationTrigger.click();
  const translationDialog = page.getByRole("dialog", {
    name: "Translation settings",
  });
  await expect(translationDialog).toBeVisible();
  await expect(translationDialog.getByLabel("Language")).toBeFocused();
  await expect(dock).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(translationDialog).toHaveCount(0);
  await expect(dock).toBeVisible();
  await expect(translationTrigger).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dock).toHaveCount(0);
  await expect(dockTrigger).toBeFocused();
});

test("coalesces pending reader model catalogs and retries after malformed 2xx", async ({
  page,
}) => {
  createReaderFixture();
  let catalogRequestCount = 0;
  let releaseFirstCatalogRequest: () => void = () => undefined;
  const firstCatalogRequestGate = new Promise<void>((resolve) => {
    releaseFirstCatalogRequest = resolve;
  });
  await page.route("**/api/settings/codex-models", async (route) => {
    catalogRequestCount += 1;
    if (catalogRequestCount === 1) {
      await firstCatalogRequestGate;
      await route.fulfill({
        contentType: "application/json",
        status: 200,
        body: JSON.stringify({ models: null }),
      });
      return;
    }

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
        ],
      }),
    });
  });

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  const trigger = page.getByRole("button", { name: "Translate memory" });
  const dialog = page.getByRole("dialog", { name: "Translation settings" });

  try {
    await trigger.click();
    await expect(dialog).toBeVisible();
    await expect.poll(() => catalogRequestCount).toBe(1);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await trigger.click();
    await expect(dialog).toBeVisible();
    await expect.poll(() => catalogRequestCount).toBe(1);

    releaseFirstCatalogRequest();
    await expect(dialog.getByRole("alert")).toHaveText(
      "Codex model catalog response was invalid.",
    );

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await trigger.click();
    await expect(dialog).toBeVisible();
    await expect.poll(() => catalogRequestCount).toBe(2);
    await expect(
      dialog.getByLabel("Model", { exact: true }).locator('option[value="gpt-5.5"]'),
    ).toHaveCount(1);
    await expect(dialog.getByRole("alert")).toHaveCount(0);
  } finally {
    releaseFirstCatalogRequest();
  }
});

test("does not submit the psychiatrist prompt while an IME composition is active", async ({
  page,
}) => {
  createReaderFixture();
  const mock = await installPsychiatristMock(page);

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();
  const prompt = page.getByRole("textbox", { name: "Message Psychiatrist" });
  await expect(prompt).toBeEnabled();
  await prompt.fill("変換中の質問");

  await prompt.dispatchEvent("keydown", {
    bubbles: true,
    isComposing: true,
    key: "Enter",
    keyCode: 13,
  });

  expect(mock.startedRequests).toEqual([]);
  await expect(prompt).toHaveValue("変換中の質問");

  await prompt.press("Enter");
  await expect.poll(() => mock.startedRequests).toHaveLength(1);
  expect(mock.startedRequests[0]?.message).toBe("変換中の質問");
});

test("keeps psychiatrist transcript scrolling sticky only near the bottom", async ({
  page,
}) => {
  createReaderFixture();
  await installPsychiatristMock(page, {
    initialPairs: [completedPsychiatristPair("Historical answer. ".repeat(320))],
  });

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();
  const transcript = page.locator("[data-psychiatrist-transcript]");
  await expect(transcript).toBeVisible();
  await expect.poll(() => transcript.evaluate((element) =>
    element.scrollHeight - element.clientHeight - element.scrollTop
  )).toBeLessThanOrEqual(1);

  const prompt = page.getByRole("textbox", { name: "Message Psychiatrist" });
  await prompt.fill("Append a new transcript pair.");
  await prompt.press("Enter");
  await expect(page.getByText("Partial answer from the memory")).toBeVisible();
  await expect.poll(() => transcript.evaluate((element) =>
    element.scrollHeight - element.clientHeight - element.scrollTop
  )).toBeLessThanOrEqual(1);

  await transcript.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await dispatchPsychiatristEvent(page, {
    data: {
      pair_id: "pair-e2e-running",
      text: " Manual-scroll delta.",
    },
    turnId: "turn-e2e-running",
    type: "psychiatrist.answer.delta",
  });
  await expect(page.getByText("Manual-scroll delta.", { exact: false })).toBeVisible();
  await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBe(0);

  await transcript.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await dispatchPsychiatristEvent(page, {
    data: {
      pair_id: "pair-e2e-running",
      text: ` ${"Bottom-following delta. ".repeat(80)}`,
    },
    turnId: "turn-e2e-running",
    type: "psychiatrist.answer.delta",
  });
  await expect.poll(() => transcript.evaluate((element) =>
    element.scrollHeight - element.clientHeight - element.scrollTop
  )).toBeLessThanOrEqual(1);
});

test("bounds a 1000-pair psychiatrist transcript while keeping pinned rows reachable", async ({
  page,
}) => {
  createReaderFixture();
  const initialPairs = Array.from(
    { length: 1_000 },
    (_, index) => completedPsychiatristPairAt(index),
  );
  initialPairs[100] = {
    ...initialPairs[100]!,
    retry_action: "allow_web_sources",
    retry_mode: "regenerate",
    retry_turn_id: "turn-history-100-retry",
  };
  await installPsychiatristMock(page, { initialPairs });

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();

  const transcript = page.locator("[data-psychiatrist-transcript]");
  const rows = transcript.locator("[data-psychiatrist-pair]");
  const range = transcript.locator("[data-psychiatrist-transcript-range]");
  const older = transcript.getByRole("button", { exact: true, name: "Older" });
  const newer = transcript.getByRole("button", { exact: true, name: "Newer" });

  await expect(range).toHaveText(
    "Showing 977–1000 of 1000; 1 pinned pair also shown: " +
      "pair 101 (web-source retry).",
  );
  await expect(range).toHaveAttribute("aria-live", "polite");
  await expect(rows).toHaveCount(25);
  expect(await rows.count()).toBeLessThanOrEqual(26);
  await expect(page.getByText("Historical answer 999.", { exact: true })).toBeVisible();
  await expect(page.getByText("Historical answer 100.", { exact: true })).toBeVisible();
  await expect(older).toHaveAttribute("aria-controls", "psychiatrist-transcript");
  await expect(newer).toBeDisabled();

  await older.click();
  await expect(range).toHaveText(
    "Showing 953–976 of 1000; 1 pinned pair also shown: " +
      "pair 101 (web-source retry).",
  );
  await expect(rows).toHaveCount(25);
  await expect(page.getByText("Historical answer 975.", { exact: true })).toBeVisible();
  await expect(page.getByText("Historical answer 999.", { exact: true })).toHaveCount(0);
  await expect(newer).toBeEnabled();

  await newer.click();
  await expect(range).toHaveText(
    "Showing 977–1000 of 1000; 1 pinned pair also shown: " +
      "pair 101 (web-source retry).",
  );
  await expect(rows).toHaveCount(25);

  const prompt = page.getByRole("textbox", { name: "Message Psychiatrist" });
  await prompt.fill("Keep the active answer reachable on an older page.");
  await prompt.press("Enter");
  await expect(page.getByText("Partial answer from the memory", { exact: false }))
    .toBeVisible();
  await expect(range).toHaveText("Showing 978–1001 of 1001.");
  await expect(rows).toHaveCount(24);

  await older.click();
  await expect(range).toHaveText(
    "Showing 954–977 of 1001; 1 pinned pair also shown: pair 1001 (active).",
  );
  await expect(page.getByText("Partial answer from the memory", { exact: false }))
    .toBeVisible();
  await expect(rows).toHaveCount(25);
  expect(await rows.count()).toBeLessThanOrEqual(26);
  await expect(older).toBeFocused();
  await transcript.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });

  await dispatchPsychiatristEvent(page, {
    data: {
      pair_id: "pair-e2e-running",
      text: " Window-pinned delta.",
    },
    turnId: "turn-e2e-running",
    type: "psychiatrist.answer.delta",
  });

  await expect(page.getByText("Window-pinned delta.", { exact: false })).toBeVisible();
  await expect(older).toBeFocused();
  await expect.poll(() => transcript.evaluate((element) => element.scrollTop)).toBe(0);
  expect(await rows.count()).toBeLessThanOrEqual(26);
});

test("projects only public Psychiatrist citations as links for persisted and SSE answers", async ({
  page,
}) => {
  createReaderFixture();
  const persistedPair = completedPsychiatristPair("Persisted cited answer.");
  persistedPair.assistant_response!.source_citations = [
    {
      source_id: "source-persisted-safe",
      title: "Persisted safe source",
      url: "https://example.com/persisted",
    },
    {
      source_id: "source-persisted-unsafe",
      title: "Persisted unsafe source",
      url: "javascript:alert(1)",
    },
  ];
  await installPsychiatristMock(page, { initialPairs: [persistedPair] });

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();

  await expect(page.getByRole("link", { name: "Persisted safe source" }))
    .toHaveAttribute("href", "https://example.com/persisted");
  await expect(page.getByText("Persisted unsafe source", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Persisted unsafe source" })).toHaveCount(0);

  const prompt = page.getByRole("textbox", { name: "Message Psychiatrist" });
  await prompt.fill("Answer with streamed citations.");
  await prompt.press("Enter");
  await expect(page.getByText("Partial answer from the memory", { exact: false }))
    .toBeVisible();
  await dispatchPsychiatristEvent(page, {
    data: {
      pair_id: "pair-e2e-running",
      source_citations: [
        {
          future_field: true,
          source_id: "source-stream-safe",
          title: "Streamed safe source",
          url: "http://example.com/streamed",
        },
        {
          source_id: "source-stream-unsafe",
          title: "Streamed unsafe source",
          url: "http://127.0.0.1/private",
        },
      ],
      text: "Streamed cited answer.",
    },
    turnId: "turn-e2e-running",
    type: "psychiatrist.answer.completed",
  });

  await expect(page.getByRole("link", { name: "Streamed safe source" }))
    .toHaveAttribute("href", "http://example.com/streamed");
  await expect(page.getByText("Streamed unsafe source", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Streamed unsafe source" })).toHaveCount(0);
});

test("keeps visible Psychiatrist process rows bounded and useful", async ({ page }) => {
  createReaderFixture();
  await installPsychiatristMock(page);

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();
  const prompt = page.getByRole("textbox", { name: "Message Psychiatrist" });
  await prompt.fill("Show bounded progress.");
  await prompt.press("Enter");
  await expect(page.getByText("Reading stored context", { exact: true })).toBeVisible();

  for (let index = 0; index < 8; index += 1) {
    await dispatchPsychiatristEvent(page, {
      data: { pair_id: "pair-e2e-running", text: `  Phase   ${index}  ` },
      turnId: "turn-e2e-running",
      type: "psychiatrist.process.delta",
    });
  }
  for (const text of ["Phase 7", "   ", "credential token /private/secret"]) {
    await dispatchPsychiatristEvent(page, {
      data: { pair_id: "pair-e2e-running", text },
      turnId: "turn-e2e-running",
      type: "psychiatrist.process.delta",
    });
  }

  const runningPair = page.locator('[data-psychiatrist-pair="pair-e2e-running"]');
  await expect(runningPair.locator("[data-psychiatrist-process]")).toHaveCount(8);
  await expect(runningPair.getByText("Reading stored context", { exact: true })).toBeVisible();
  await expect(runningPair.getByText("Phase 0", { exact: true })).toHaveCount(0);
  for (let index = 1; index < 8; index += 1) {
    await expect(runningPair.getByText(`Phase ${index}`, { exact: true })).toBeVisible();
  }
  await expect(page.getByText("Partial answer from the memory", { exact: false }))
    .toBeVisible();
});

test("hands loading Psychiatrist focus from Close to the enabled prompt", async ({
  page,
}) => {
  createReaderFixture();
  const mock = await installPsychiatristMock(page, { deferThreadRequests: [1] });

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();
  await expect.poll(() => mock.releaseThread !== undefined).toBe(true);
  await expect(page.getByRole("button", { name: "Close" })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Message Psychiatrist" })).toBeDisabled();

  mock.releaseThread?.();
  await expect(page.getByRole("textbox", { name: "Message Psychiatrist" })).toBeEnabled();
  await expect(page.getByRole("textbox", { name: "Message Psychiatrist" })).toBeFocused();
});

test("does not steal focus moved by the user during Psychiatrist loading", async ({
  page,
}) => {
  createReaderFixture();
  const mock = await installPsychiatristMock(page, { deferThreadRequests: [1] });

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  const trigger = page.getByRole("button", { name: "Open Psychiatrist" });
  await trigger.click();
  await expect.poll(() => mock.releaseThread !== undefined).toBe(true);
  await expect(page.getByRole("button", { name: "Close" })).toBeFocused();
  await trigger.focus();

  mock.releaseThread?.();
  await expect(page.getByRole("textbox", { name: "Message Psychiatrist" })).toBeEnabled();
  await expect(trigger).toBeFocused();
});

test("does not steal focus when Psychiatrist loading resolves after close", async ({
  page,
}) => {
  createReaderFixture();
  const mock = await installPsychiatristMock(page, { deferThreadRequests: [1] });

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  const trigger = page.getByRole("button", { name: "Open Psychiatrist" });
  await trigger.click();
  await expect.poll(() => mock.releaseThread !== undefined).toBe(true);
  await expect(page.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Psychiatrist" })).toHaveCount(0);
  await expect(trigger).toBeFocused();

  const threadResponse = page.waitForResponse((response) =>
    response.url().endsWith(`/api/memories/${READER_MEMORY_ID}/psychiatrist/threads`)
  );
  mock.releaseThread?.();
  await threadResponse;
  await expect(page.getByRole("region", { name: "Psychiatrist" })).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("closes a malformed terminal stream and reconciles once from the canonical thread", async ({
  page,
}) => {
  createReaderFixture();
  const turnId = "turn-e2e-real-sse";
  const pairId = "pair-e2e-real-sse";
  const transport = await createControlledPsychiatristSseTransport({ pairId, turnId });
  try {
    await page.addInitScript(() => {
      const state = window as typeof window & {
        __psychiatristNativeEventSourceCloseCount?: number;
      };
      const NativeEventSource = window.EventSource;
      state.__psychiatristNativeEventSourceCloseCount = 0;
      class TrackedEventSource extends NativeEventSource {
        override close() {
          state.__psychiatristNativeEventSourceCloseCount =
            (state.__psychiatristNativeEventSourceCloseCount ?? 0) + 1;
          super.close();
        }
      }
      Object.defineProperty(window, "EventSource", {
        configurable: true,
        value: TrackedEventSource,
      });
    });
    const mock = await installPsychiatristMock(page, {
      eventUrlForTurn: () => transport.eventUrl,
      sendTurns: [{ pairId, turnId }],
      useFakeEventSource: false,
    });

    await page.goto(`/memories/${READER_MEMORY_ID}`);
    await waitForReaderReady(page);
    await page.getByRole("button", { name: "Open Psychiatrist" }).click();
    await page.locator("textarea").fill("Exercise the real SSE transport.");
    await page.getByRole("button", { name: "Send" }).click();

    await expect.poll(() => transport.requestedUrls.length).toBe(1);
    const requestedUrl = new URL(transport.requestedUrls[0]!, transport.origin);
    expect(requestedUrl.pathname).toBe(
      `/api/memories/${READER_MEMORY_ID}/psychiatrist/threads/thread-e2e` +
        `/turns/${turnId}/events`,
    );
    expect(requestedUrl.searchParams.get("variant_kind")).toBe("source");
    await expect(page.getByText("Real SSE process update.")).toBeVisible();
    await expect(page.getByText("Real SSE partial answer.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop" })).toBeEnabled();
    expect(transport.clientClosed()).toBe(false);

    mock.completeActiveTurn?.("Canonical answer after malformed terminal.");
    transport.sendMalformedTerminalAndClose();

    await expect.poll(() => mock.threadRequests).toBe(2);
    await expect(page.getByText("Canonical answer after malformed terminal."))
      .toBeVisible();
    await expect(page.getByRole("button", { exact: true, name: "Stop" })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Message Psychiatrist" }))
      .toBeEnabled();
    expect(mock.cancelRequests).toBe(0);
    expect(transport.requestedUrls).toHaveLength(1);
    await expect.poll(() => page.evaluate(() =>
      (window as typeof window & {
        __psychiatristNativeEventSourceCloseCount?: number;
      }).__psychiatristNativeEventSourceCloseCount ?? 0
    )).toBeGreaterThan(0);
  } finally {
    await transport.close();
  }
});

test("shows Retry when malformed-terminal canonical reconciliation fails", async ({
  page,
}) => {
  createReaderFixture();
  const turnId = "turn-e2e-real-sse-failed-reload";
  const pairId = "pair-e2e-real-sse-failed-reload";
  const transport = await createControlledPsychiatristSseTransport({ pairId, turnId });
  try {
    const mock = await installPsychiatristMock(page, {
      eventUrlForTurn: () => transport.eventUrl,
      sendTurns: [{ pairId, turnId }],
      threadFailureRequests: [2],
      useFakeEventSource: false,
    });

    await page.goto(`/memories/${READER_MEMORY_ID}`);
    await waitForReaderReady(page);
    await page.getByRole("button", { name: "Open Psychiatrist" }).click();
    await page.getByRole("textbox", { name: "Message Psychiatrist" })
      .fill("Reconcile a failed canonical reload.");
    await page.getByRole("button", { name: "Send" }).click();
    await expect.poll(() => transport.requestedUrls.length).toBe(1);

    transport.sendMalformedTerminalAndClose();

    await expect.poll(() => mock.threadRequests).toBe(2);
    await expect(page.getByRole("button", { name: "Retry thread load" })).toBeVisible();
    expect(mock.cancelRequests).toBe(0);
    expect(transport.requestedUrls).toHaveLength(1);
  } finally {
    await transport.close();
  }
});

test("caps malformed-terminal canonical reconciliation at one automatic reload per turn", async ({
  page,
}) => {
  createReaderFixture();
  const turnId = "turn-e2e-real-sse-budget";
  const pairId = "pair-e2e-real-sse-budget";
  const transport = await createControlledPsychiatristSseTransport({ pairId, turnId });
  try {
    const mock = await installPsychiatristMock(page, {
      eventUrlForTurn: () => transport.eventUrl,
      sendTurns: [{ pairId, turnId }],
      useFakeEventSource: false,
    });

    await page.goto(`/memories/${READER_MEMORY_ID}`);
    await waitForReaderReady(page);
    await page.getByRole("button", { name: "Open Psychiatrist" }).click();
    await page.getByRole("textbox", { name: "Message Psychiatrist" })
      .fill("Bound malformed terminal recovery.");
    await page.getByRole("button", { name: "Send" }).click();
    await expect.poll(() => transport.requestedUrls.length).toBe(1);

    transport.sendMalformedTerminalAndClose();
    await expect.poll(() => mock.threadRequests).toBe(2);
    await expect.poll(() => transport.requestedUrls.length).toBe(2);

    transport.sendMalformedTerminalAndClose();
    await expect(page.getByRole("button", { name: "Retry thread load" })).toBeVisible();
    expect(mock.threadRequests).toBe(2);
    expect(mock.cancelRequests).toBe(0);
    expect(transport.requestedUrls).toHaveLength(2);
  } finally {
    await transport.close();
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
  await expect(page.getByText("Partial answer from the memory")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  expect(mock.cancelRequests).toBe(1);
});

test("reloads the canonical psychiatrist thread when completion wins the Stop race", async ({
  page,
}) => {
  createReaderFixture();
  const mock = await installPsychiatristMock(page, {
    cancelResults: ["completed"],
    deferNextCancel: true,
  });

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();
  await page.locator("textarea").fill("Finish while Stop races.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Partial answer from the memory")).toBeVisible();

  const stopClick = page.getByRole("button", { name: "Stop" }).click();

  await expect.poll(() => mock.releaseCancel !== undefined).toBe(true);
  await expect(page.getByRole("button", { name: "Stopping…" })).toBeDisabled();
  await expect(page.getByRole("button", { exact: true, name: "Stop" })).toHaveCount(0);
  mock.releaseCancel?.();
  await stopClick;

  await expect(page.getByText("Canonical answer completed before cancellation."))
    .toBeVisible();
  await expect(page.getByText("Partial answer from the memory")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Message Psychiatrist" }))
    .toBeEnabled();
  expect(mock.threadRequests).toBeGreaterThan(1);
});

test("keeps a terminal psychiatrist turn final when its pending Stop request later fails", async ({
  page,
}) => {
  createReaderFixture();
  const mock = await installPsychiatristMock(page, {
    deferNextCancel: true,
    rejectNextCancel: true,
  });

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();
  await page.locator("textarea").fill("Finish before Stop returns.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("button", { name: "Stop" })).toBeEnabled();

  const stopClick = page.getByRole("button", { name: "Stop" }).click();
  await expect.poll(() => mock.releaseCancel !== undefined).toBe(true);
  await dispatchPsychiatristEvent(page, {
    data: {
      pair_id: "pair-e2e-running",
      source_citations: [],
      text: "Terminal answer won the Stop race.",
    },
    turnId: "turn-e2e-running",
    type: "psychiatrist.answer.completed",
  });
  mock.releaseCancel?.();
  await stopClick;

  await expect(page.getByText("Terminal answer won the Stop race.")).toBeVisible();
  await expect(page.getByRole("button", { exact: true, name: "Stop" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Message Psychiatrist" }))
    .toBeEnabled();
});

test("adopts a canonical successor after a successful canceled response", async ({
  page,
}) => {
  createReaderFixture();
  await installPsychiatristMock(page, {
    activeTurnAfterCancel: {
      pairId: "pair-e2e-successor",
      turnId: "turn-e2e-successor",
    },
    cancelResults: ["canceled"],
    sendTurns: [{ pairId: "pair-e2e-old", turnId: "turn-e2e-old" }],
  });

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();
  await page.locator("textarea").fill("Cancel only the old turn.");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { exact: true, name: "Stop" }).click();

  await expect(page.getByRole("button", { exact: true, name: "Stop" })).toBeEnabled();
  await expect.poll(async () => page.evaluate(() =>
    ((window as unknown as { __psychiatristEventSourceUrls?: string[] })
      .__psychiatristEventSourceUrls ?? [])
      .some((url) => url.includes("turn-e2e-successor"))
  )).toBe(true);
});

test("becomes idle when a rejected cancel response persisted cancellation", async ({
  page,
}) => {
  createReaderFixture();
  const mock = await installPsychiatristMock(page, {
    canonicalizeRejectedCancel: true,
    rejectNextCancel: true,
  });

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();
  await page.locator("textarea").fill("The server may cancel despite the response.");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { exact: true, name: "Stop" }).click();

  await expect(page.getByRole("button", { exact: true, name: "Stop" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  await expect.poll(() => mock.threadRequests).toBeGreaterThan(1);
});

test("restores the exact old active turn after an ambiguous cancel failure", async ({
  page,
}) => {
  createReaderFixture();
  const mock = await installPsychiatristMock(page, {
    rejectNextCancel: true,
  });

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();
  await page.locator("textarea").fill("Keep running if canonical state says so.");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { exact: true, name: "Stop" }).click();

  await expect.poll(() => mock.threadRequests).toBeGreaterThan(1);
  await expect(page.getByRole("button", { exact: true, name: "Stop" })).toBeEnabled();
  await expect(page.getByRole("alert").filter({
    hasText: "Psychiatrist could not finish. Retry when ready.",
  })).toBeVisible();
});

test("keeps canceled Stop non-repeatable until failed reconciliation is retried", async ({
  page,
}) => {
  createReaderFixture();
  await installPsychiatristMock(page, {
    cancelResults: ["canceled"],
    threadFailureRequests: [2],
  });

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();
  await page.locator("textarea").fill("Retry canonical reconciliation.");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { exact: true, name: "Stop" }).click();

  await expect(page.getByRole("button", { exact: true, name: "Stop" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Stopping…" })).toBeDisabled();
  await page.getByRole("button", { name: "Retry thread load" }).click();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message Psychiatrist" }))
    .toBeEnabled();
});

test("adopts a different canonical active turn after the stopped turn completed", async ({
  page,
}) => {
  createReaderFixture();
  await installPsychiatristMock(page, {
    activeTurnAfterCancel: {
      pairId: "pair-e2e-running",
      turnId: "turn-e2e-canonical-active",
    },
    cancelResults: ["completed"],
    sendTurns: [{ pairId: "pair-e2e-old", turnId: "turn-e2e-old" }],
  });

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();
  await page.locator("textarea").fill("Stop the old turn only.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("button", { name: "Stop" })).toBeEnabled();
  await page.getByRole("button", { name: "Stop" }).click();

  await expect(page.getByRole("button", { name: "Stop" })).toBeEnabled();
  await expect.poll(async () => page.evaluate(() =>
    ((window as unknown as { __psychiatristEventSourceUrls?: string[] })
      .__psychiatristEventSourceUrls ?? [])
      .some((url) => url.includes("turn-e2e-canonical-active"))
  )).toBe(true);
});

test("clears stopping when Stop reload resumes a different idle thread", async ({
  page,
}) => {
  createReaderFixture();
  await installPsychiatristMock(page, {
    cancelResults: ["completed"],
    sendTurns: [{ pairId: "pair-e2e-old", turnId: "turn-e2e-old" }],
    threadIdAfterCancel: "thread-e2e-next",
  });

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();
  await page.locator("textarea").fill("Finish on the old thread.");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { exact: true, name: "Stop" }).click();

  await expect(page.getByRole("button", { name: "Stopping…" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message Psychiatrist" }))
    .toBeEnabled();
});

test("adopts a successor active turn from a different Stop-reload thread", async ({
  page,
}) => {
  createReaderFixture();
  await installPsychiatristMock(page, {
    activeTurnAfterCancel: {
      pairId: "pair-e2e-successor",
      turnId: "turn-e2e-successor",
    },
    cancelResults: ["completed"],
    sendTurns: [{ pairId: "pair-e2e-old", turnId: "turn-e2e-old" }],
    threadIdAfterCancel: "thread-e2e-next",
  });

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();
  await page.locator("textarea").fill("Adopt the successor thread turn.");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { exact: true, name: "Stop" }).click();

  await expect(page.getByRole("button", { exact: true, name: "Stop" })).toBeEnabled();
  await expect.poll(async () => page.evaluate(() =>
    ((window as unknown as { __psychiatristEventSourceUrls?: string[] })
      .__psychiatristEventSourceUrls ?? [])
      .some((url) =>
        url.includes("/threads/thread-e2e-next/") &&
        url.includes("turn-e2e-successor")
      )
  )).toBe(true);
});

test("does not carry a historical web-source retry into a successor active turn", async ({
  page,
}) => {
  createReaderFixture();
  const historicalRetryPair = {
    ...completedPsychiatristPair("Historical answer requiring sources."),
    pair_id: "pair-e2e-historical",
    retry_action: "allow_web_sources" as const,
    retry_mode: "regenerate" as const,
    retry_turn_id: "turn-e2e-historical-retry",
    turn_id: "turn-e2e-historical",
  };
  const mock = await installPsychiatristMock(page, {
    activeTurnAfterCancel: {
      pairId: "pair-e2e-successor",
      turnId: "turn-e2e-successor",
    },
    cancelResults: ["completed"],
    initialPairs: [historicalRetryPair],
    sendTurns: [{ pairId: "pair-e2e-old", turnId: "turn-e2e-old" }],
    threadIdAfterCancel: "thread-e2e-next",
  });

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();
  await page.locator("textarea").fill("Run the successor without stale approval UI.");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { exact: true, name: "Stop" }).click();

  await expect.poll(() => mock.threadRequests).toBeGreaterThan(1);
  await expect(page.getByRole("button", {
    name: "Allow web sources for this turn",
  })).toHaveCount(0);
  await expect(page.getByRole("alert").filter({
    hasText: "Allow web search/source lookup for this answer to continue.",
  })).toHaveCount(0);
  await expect(page.getByRole("button", { exact: true, name: "Stop" })).toBeEnabled();
});

test("keeps Stop unavailable while a psychiatrist turn is starting", async ({
  page,
}) => {
  createReaderFixture();
  const mock = await installPsychiatristMock(page, { deferNextSend: true });

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();
  await page.locator("textarea").fill("Wait for identifiers.");
  const sendClick = page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByRole("button", { name: "Starting…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0);
  await expect.poll(() => mock.releaseSend !== undefined).toBe(true);
  mock.releaseSend?.();
  await sendClick;
  await expect(page.getByRole("button", { name: "Stop" })).toBeEnabled();
});

test("keeps psychiatrist actions disabled until thread loading succeeds and can retry", async ({
  page,
}) => {
  createReaderFixture();
  await installPsychiatristMock(page, { threadFailures: 1 });

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();

  const close = page.getByRole("button", { name: "Close" });
  await expect(page.getByRole("textbox", { name: "Message Psychiatrist" }))
    .toBeDisabled();
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Retry thread load" })).toBeVisible();
  await expect(page.getByRole("alert"))
    .toContainText("Start the Codex app-server, then retry Psychiatrist.");
  await expect(close).toBeFocused();
  await close.press("Tab");
  await expect(page.getByRole("button", { name: "Retry thread load" })).toBeFocused();

  await page.getByRole("button", { name: "Retry thread load" }).click();

  await expect(page.getByRole("textbox", { name: "Message Psychiatrist" }))
    .toBeEnabled();
  await expect(page.getByRole("button", { name: "Retry thread load" })).toHaveCount(0);
});

test("native-disables every Regenerate action while a psychiatrist turn is busy", async ({
  page,
}) => {
  createReaderFixture();
  const secondPair = {
    ...completedPsychiatristPair("Second completed answer."),
    pair_id: "pair-e2e-second",
    turn_id: "turn-e2e-second",
  };
  const mock = await installPsychiatristMock(page, {
    deferNextRegenerate: true,
    initialPairs: [
      completedPsychiatristPair("First completed answer."),
      secondPair,
    ],
  });

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();
  const regenerateButtons = page.getByRole("button", { name: "Regenerate" });
  await expect(regenerateButtons).toHaveCount(2);
  const regenerateClick = regenerateButtons.first().click();

  await expect.poll(() => mock.releaseRegenerate !== undefined).toBe(true);
  await expect(regenerateButtons.nth(0)).toBeDisabled();
  await expect(regenerateButtons.nth(1)).toBeDisabled();
  mock.releaseRegenerate?.();
  await regenerateClick;
});

test("keeps a newer psychiatrist turn running when the stopped stream delivers a late terminal event", async ({
  page,
}) => {
  createReaderFixture();
  const mock = await installPsychiatristMock(page, {
    sendTurns: [
      { pairId: "pair-e2e-old", turnId: "turn-e2e-old" },
      { pairId: "pair-e2e-new", turnId: "turn-e2e-new" },
    ],
  });

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();

  await page.locator("textarea").fill("Start the old turn.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();

  await page.locator("textarea").fill("Start the newer turn.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();

  await dispatchPsychiatristEvent(page, {
    data: {
      code: "turn_canceled",
      pair_id: "pair-e2e-old",
      status: "canceled",
    },
    turnId: "turn-e2e-old",
    type: "psychiatrist.turn.canceled",
  });

  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  expect(mock.cancelRequests).toBe(1);
});

test("does not connect a deferred psychiatrist turn after the reader unmounts", async ({
  page,
}) => {
  createReaderFixture();
  const mock = await installPsychiatristMock(page);
  await page.addInitScript((responseBody) => {
    const originalFetch = window.fetch.bind(window);
    Object.defineProperty(window, "fetch", {
      configurable: true,
      value: (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        if (
          url.endsWith(
            "/api/memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f101" +
              "/psychiatrist/threads/thread-e2e/messages",
          ) &&
          init?.method === "POST"
        ) {
          const state = window as unknown as {
            __deferredPsychiatristSendPending?: boolean;
            __releaseDeferredPsychiatristSend?: () => void;
          };
          state.__deferredPsychiatristSendPending = true;
          return new Promise<Response>((resolve) => {
            state.__releaseDeferredPsychiatristSend = () => resolve(new Response(
              JSON.stringify(responseBody),
              {
                headers: { "content-type": "application/json" },
                status: 202,
              },
            ));
          });
        }
        return originalFetch(input, init);
      },
    });
  }, startedResponse("pair-e2e-deferred", "turn-e2e-deferred"));

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();
  await page.locator("textarea").fill("Resolve this after navigation.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(async () => page.evaluate(() =>
    (window as unknown as { __deferredPsychiatristSendPending?: boolean })
      .__deferredPsychiatristSendPending ?? false
  )).toBe(true);

  await page.evaluate(() => {
    const link = document.createElement("a");
    link.href = "/memories";
    link.textContent = "Leave the reader";
    document.body.append(link);
  });
  await page.getByRole("link", { name: "Leave the reader" }).click();
  await expect(page).toHaveURL(/\/memories$/);
  await page.evaluate(() => {
    const state = window as unknown as {
      __releaseDeferredPsychiatristSend?: () => void;
    };
    if (state.__releaseDeferredPsychiatristSend === undefined) {
      throw new Error("Deferred Psychiatrist send resolver is unavailable");
    }
    state.__releaseDeferredPsychiatristSend();
  });
  await page.evaluate(() => new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  }));

  await expect.poll(async () => page.evaluate(() =>
    ((window as unknown as { __psychiatristEventSourceUrls?: string[] })
      .__psychiatristEventSourceUrls ?? [])
      .filter((url) => url.includes("turn-e2e-deferred")).length
  )).toBe(0);
  expect(mock.cancelRequests).toBe(0);
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
  await expect.poll(() => mock.threadRequests).toBeGreaterThan(0);

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
  await expect(page.getByRole("alert").filter({
    hasText: "Psychiatrist could not finish. Retry when ready.",
  }))
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

  await expect(page.getByRole("alert").filter({
    hasText: "Allow web search/source lookup for this answer to continue.",
  }))
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

test("retains persisted web-source approval after an ambiguous Regenerate failure", async ({
  page,
}) => {
  createReaderFixture();
  const retryPair = {
    ...completedPsychiatristPair("Answer awaiting approved sources."),
    retry_action: "allow_web_sources" as const,
    retry_mode: "regenerate" as const,
    retry_turn_id: "turn-e2e-retry",
  };
  const mock = await installPsychiatristMock(page, {
    initialPairs: [retryPair],
    threadFailureRequests: [2],
  });
  mock.failNextRegenerate = true;

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await page.getByRole("button", { name: "Open Psychiatrist" }).click();
  const approval = page.getByRole("button", {
    name: "Allow web sources for this turn",
  });
  await expect(approval).toBeVisible();

  await approval.click();

  await expect(approval).toBeVisible();
  await expect(approval).toBeDisabled();
  await page.getByRole("button", { name: "Retry thread load" }).click();
  await expect(approval).toBeEnabled();
  await approval.click();
  await expect(page.getByText("Regenerated answer from the same pair.")).toBeVisible();
  expect(mock.regenerateRequests).toEqual([
    { pairId: "pair-e2e", web_source_permission: "allow_for_this_turn" },
    { pairId: "pair-e2e", web_source_permission: "allow_for_this_turn" },
  ]);
  expect(mock.threadRequests).toBeGreaterThan(1);
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
  completeActiveTurn?: (content: string) => void;
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
  releaseCancel?: () => void;
  releaseRegenerate?: () => void;
  releaseSend?: () => void;
  releaseThread?: () => void;
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
  threadRequests: number;
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
  retry_action?: "allow_web_sources";
  retry_mode?: "first_answer" | "regenerate";
  retry_turn_id?: string;
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
    activeTurnAfterCancel?: { pairId: string; turnId: string };
    cancelResults?: Array<"canceled" | "completed" | "failed">;
    canonicalizeRejectedCancel?: boolean;
    deferNextCancel?: boolean;
    deferNextRegenerate?: boolean;
    deferNextSend?: boolean;
    deferThreadRequests?: number[];
    eventUrlForTurn?: (turnId: string) => string;
    initialPairs?: PsychiatristPairFixture[];
    rejectNextCancel?: boolean;
    sendTurns?: Array<{ pairId: string; turnId: string }>;
    threadFailureRequests?: number[];
    threadFailures?: number;
    threadIdAfterCancel?: string;
    useFakeEventSource?: boolean;
  } = {},
): Promise<PsychiatristMockState> {
  if (input.useFakeEventSource !== false) {
    await page.addInitScript(installFakeEventSourceInBrowser, psychiatristEventFramesByTurn());
  }

  const state: PsychiatristMockState = {
    cancelRequests: 0,
    failNextRegenerate: false,
    networkEnabledBeforeApproval: false,
    regenerateRequests: [],
    stopNextRegenerate: false,
    startedRequests: [],
    threadRequests: 0,
  };
  let activeTurn: { pair_id: string; turn_id: string } | null = null;
  let acceptedSendCount = 0;
  let cancelCount = 0;
  let currentThreadId = "thread-e2e";
  let pairs = [...(input.initialPairs ?? [])];
  let remainingThreadFailures = input.threadFailures ?? 0;
  state.completeActiveTurn = (content: string) => {
    if (activeTurn === null) {
      throw new Error("No active Psychiatrist turn can be completed");
    }
    const completedTurn = activeTurn;
    pairs = pairs.map((pair) =>
      pair.pair_id === completedTurn.pair_id
        ? {
            ...pair,
            assistant_response: {
              completed_at: "2026-06-03T00:00:05.000Z",
              content,
              source_citations: [],
            },
            status: "completed",
          }
        : pair
    );
    activeTurn = null;
  };

  await page.route(`**/api/memories/${READER_MEMORY_ID}/psychiatrist/threads`, async (route) => {
    state.threadRequests += 1;
    if (
      input.deferThreadRequests?.includes(state.threadRequests) === true &&
      state.releaseThread === undefined
    ) {
      await new Promise<void>((resolve) => {
        state.releaseThread = resolve;
      });
    }
    const consumesRemainingFailure = remainingThreadFailures > 0;
    if (
      consumesRemainingFailure ||
      input.threadFailureRequests?.includes(state.threadRequests) === true
    ) {
      if (consumesRemainingFailure) {
        remainingThreadFailures -= 1;
      }
      await route.fulfill({
        contentType: "application/json",
        status: 503,
        body: JSON.stringify({
          action: "retry",
          code: "app_server_unavailable",
          message: "Psychiatrist thread loading failed.",
          status: "error",
        }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        active_turn: activeTurn === null
          ? null
          : {
              event_url: input.eventUrlForTurn?.(activeTurn.turn_id) ??
                psychiatristEventUrl(activeTurn.turn_id, currentThreadId),
              pair_id: activeTurn.pair_id,
              status: "running",
              turn_id: activeTurn.turn_id,
            },
        content_hash: "sha256:e2e-reader",
        lang_code: null,
        memory_id: READER_MEMORY_ID,
        pairs,
        status: activeTurn === null ? "ready" : "running",
        thread_id: currentThreadId,
        variant_kind: "source",
      }),
    });
  });

  await page.route(
    `**/api/memories/${READER_MEMORY_ID}/psychiatrist/threads/thread-e2e/messages`,
    async (route) => {
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
      const configuredTurn = input.sendTurns?.[acceptedSendCount];
      acceptedSendCount += 1;
      activeTurn = configuredTurn === undefined
        ? { pair_id: "pair-e2e-running", turn_id: "turn-e2e-running" }
        : { pair_id: configuredTurn.pairId, turn_id: configuredTurn.turnId };
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

    if (input.deferNextSend === true && state.releaseSend === undefined) {
      await new Promise<void>((resolve) => {
        state.releaseSend = resolve;
      });
    }

    await route.fulfill({
      contentType: "application/json",
      status: 202,
      body: JSON.stringify(startedResponse(
        activeTurn.pair_id,
        activeTurn.turn_id,
        input.eventUrlForTurn?.(activeTurn.turn_id),
      )),
    });
    },
  );

  await page.route("**/psychiatrist/threads/thread-e2e/pairs/*/regenerate", async (route) => {
    const pairId = route.request().url().match(/\/pairs\/([^/]+)\/regenerate/)?.[1] ??
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
    if (input.deferNextRegenerate === true && state.releaseRegenerate === undefined) {
      await new Promise<void>((resolve) => {
        state.releaseRegenerate = resolve;
      });
    }
    await route.fulfill({
      contentType: "application/json",
      status: 202,
      body: JSON.stringify(startedResponse(pairId, activeTurn.turn_id)),
    });
    if (activeTurn.turn_id === "turn-e2e-regenerate") {
      activeTurn = null;
      pairs = pairs.map((pair) =>
        pair.pair_id === pairId
          ? completedPsychiatristPair("Regenerated answer from the same pair.")
          : pair
      );
    }
  });

  await page.route("**/psychiatrist/threads/thread-e2e/turns/*/cancel", async (route) => {
    state.cancelRequests += 1;
    const turnId = route.request().url().match(/\/turns\/([^/]+)\/cancel/)?.[1] ?? "";
    const cancelStatus = input.cancelResults?.[cancelCount] ?? "canceled";
    cancelCount += 1;
    if (activeTurn?.turn_id === "turn-e2e-regenerate-stopped") {
      pairs = pairs.map((pair) =>
        pair.pair_id === "pair-e2e"
          ? completedPsychiatristPair("Regenerated answer from the same pair.")
          : pair
      );
    }
    if (cancelStatus === "completed" && activeTurn !== null) {
      const completedPairId = activeTurn.pair_id;
      pairs = pairs.map((pair) =>
        pair.pair_id === completedPairId
          ? {
              ...pair,
              assistant_response: {
                completed_at: "2026-06-03T00:00:03.000Z",
                content: "Canonical answer completed before cancellation.",
                source_citations: [],
              },
              status: "completed",
            }
          : pair
      );
    }
    if (cancelStatus === "failed" && activeTurn !== null) {
      const failedPairId = activeTurn.pair_id;
      pairs = pairs.map((pair) =>
        pair.pair_id === failedPairId ? { ...pair, status: "failed" } : pair
      );
    }
    if (input.deferNextCancel === true && state.releaseCancel === undefined) {
      await new Promise<void>((resolve) => {
        state.releaseCancel = resolve;
      });
    }
    if (input.rejectNextCancel === true && input.canonicalizeRejectedCancel !== true) {
      await route.fulfill({
        contentType: "application/json",
        status: 500,
        body: JSON.stringify({
          action: "retry",
          code: "timeout",
          message: "Cancel timed out after the turn became terminal.",
          status: "error",
        }),
      });
      return;
    }
    if (cancelStatus === "canceled" && activeTurn !== null) {
      const canceledTurnId = activeTurn.turn_id;
      pairs = pairs.map((pair) =>
        pair.turn_id === canceledTurnId ? { ...pair, status: "canceled" } : pair
      );
    }
    activeTurn = input.activeTurnAfterCancel === undefined
      ? null
      : {
          pair_id: input.activeTurnAfterCancel.pairId,
          turn_id: input.activeTurnAfterCancel.turnId,
        };
    currentThreadId = input.threadIdAfterCancel ?? currentThreadId;
    if (
      activeTurn !== null &&
      !pairs.some((pair) => pair.pair_id === activeTurn?.pair_id)
    ) {
      pairs = [
        ...pairs,
        {
          pair_id: activeTurn.pair_id,
          status: "pending",
          turn_id: activeTurn.turn_id,
          user_prompt: {
            content: "Canonical successor turn.",
            created_at: "2026-06-03T00:00:04.000Z",
          },
        },
      ];
    }
    if (input.rejectNextCancel === true) {
      await route.fulfill({
        contentType: "application/json",
        status: 500,
        body: JSON.stringify({
          action: "retry",
          code: "timeout",
          message: "Cancel timed out after the turn became terminal.",
          status: "error",
        }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      status: cancelStatus === "canceled" ? 202 : 200,
      body: JSON.stringify({
        status: cancelStatus,
        turn_id: turnId,
      }),
    });
  });

  return state;
}

async function installFakeEventSource(page: Page) {
  await page.evaluate(installFakeEventSourceInBrowser, psychiatristEventFramesByTurn());
}

async function dispatchPsychiatristEvent(
  page: Page,
  input: {
    data: Record<string, unknown>;
    turnId: string;
    type: string;
  },
) {
  await page.evaluate((event) => {
    const dispatch = (window as unknown as {
      __dispatchPsychiatristEvent?: (
        turnId: string,
        type: string,
        data: Record<string, unknown>,
      ) => void;
    }).__dispatchPsychiatristEvent;
    if (dispatch === undefined) {
      throw new Error("Psychiatrist EventSource dispatcher is unavailable");
    }
    dispatch(event.turnId, event.type, event.data);
  }, input);
}

function installFakeEventSourceInBrowser(framesByTurn: Record<string, PsychiatristSseFrame[]>) {
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
      const turnId = url.match(/\/turns\/([^/]+)\/events/)?.[1] ?? "default";
      const frames = framesByTurn[turnId] ?? framesByTurn.default ?? [];
      return frames.map((frame) => [
        frame.type,
        eventData(frame.type, turnId, frame.eventId, frame.data),
      ]);
    };
    const instances: FakeEventSource[] = [];
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
        instances.push(this);
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
    Object.defineProperty(window, "__dispatchPsychiatristEvent", {
      configurable: true,
      value: (turnId: string, type: string, data: Record<string, unknown>) => {
        const serialized = eventData(type, turnId, "late", data);
        for (const instance of instances) {
          if (instance.url.includes(`/turns/${turnId}/events`)) {
            instance.dispatchEvent(new MessageEvent(type, { data: serialized }));
          }
        }
      },
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

function completedPsychiatristPairAt(index: number): PsychiatristPairFixture {
  return {
    ...completedPsychiatristPair(`Historical answer ${index}.`),
    pair_id: `pair-history-${index}`,
    turn_id: `turn-history-${index}`,
    user_prompt: {
      content: `Historical question ${index}?`,
      created_at: "2026-06-03T00:00:00.000Z",
    },
  };
}

function startedResponse(pairId: string, turnId: string, eventUrl?: string) {
  const resolvedEventUrl = eventUrl ?? psychiatristEventUrl(turnId);
  return {
    event_url: resolvedEventUrl,
    pair_id: pairId,
    replay_url: resolvedEventUrl,
    status: "started",
    thread_id: "thread-e2e",
    turn_id: turnId,
  };
}

function psychiatristEventUrl(turnId: string, threadId = "thread-e2e"): string {
  return `/api/memories/${READER_MEMORY_ID}/psychiatrist/threads/${threadId}` +
    `/turns/${turnId}/events?variant_kind=source`;
}

interface PsychiatristSseFrame {
  data: Record<string, unknown>;
  eventId: string;
  type: string;
}

function psychiatristEventFramesByTurn(): Record<string, PsychiatristSseFrame[]> {
  return {
    default: [
      {
        data: {
          pair_id: "pair-e2e-running",
          status: "running",
          user_prompt: "What does this memory say?",
        },
        eventId: "000",
        type: "psychiatrist.turn.started",
      },
      {
        data: {
          pair_id: "pair-e2e-running",
          text: "Reading stored context",
        },
        eventId: "001",
        type: "psychiatrist.process.delta",
      },
      {
        data: {
          pair_id: "pair-e2e-running",
          text: "Partial answer from the memory",
        },
        eventId: "002",
        type: "psychiatrist.answer.delta",
      },
    ],
    "turn-e2e-regenerate": [
      {
        data: { pair_id: "pair-e2e", status: "running" },
        eventId: "001",
        type: "psychiatrist.regenerate.started",
      },
      {
        data: {
          pair_id: "pair-e2e",
          text: "Regenerated answer from the same pair.",
        },
        eventId: "002",
        type: "psychiatrist.answer.delta",
      },
      {
        data: {
          pair_id: "pair-e2e",
          text: "Regenerated answer from the same pair.",
        },
        eventId: "003",
        type: "psychiatrist.regenerate.completed",
      },
    ],
    "turn-e2e-regenerate-stopped": [
      {
        data: { pair_id: "pair-e2e", status: "running" },
        eventId: "001",
        type: "psychiatrist.regenerate.started",
      },
    ],
    "turn-e2e-web": [
      {
        data: {
          pair_id: "pair-e2e-web",
          status: "running",
          user_prompt: "Use current web sources for this memory.",
        },
        eventId: "000",
        type: "psychiatrist.turn.started",
      },
      {
        data: {
          pair_id: "pair-e2e-web",
          text: "Approved answer with cited source.",
        },
        eventId: "001",
        type: "psychiatrist.answer.delta",
      },
      {
        data: {
          pair_id: "pair-e2e-web",
          text: "Approved answer with cited source.",
        },
        eventId: "002",
        type: "psychiatrist.answer.completed",
      },
    ],
  };
}

interface ControlledPsychiatristSseTransport {
  clientClosed: () => boolean;
  close: () => Promise<void>;
  eventUrl: string;
  origin: string;
  requestedUrls: string[];
  sendMalformedTerminalAndClose: () => void;
}

async function createControlledPsychiatristSseTransport(input: {
  pairId: string;
  turnId: string;
}): Promise<ControlledPsychiatristSseTransport> {
  let activeResponse: ServerResponse | undefined;
  let clientClosed = false;
  const requestedUrls: string[] = [];
  const server: Server = createServer((request, response) => {
    clientClosed = false;
    requestedUrls.push(request.url ?? "");
    activeResponse = response;
    response.on("close", () => {
      clientClosed = true;
    });
    response.writeHead(200, {
      "access-control-allow-origin": "*",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "content-type": "text/event-stream",
    });
    response.flushHeaders();
    response.write(sseEvent(
      "psychiatrist.turn.started",
      input.turnId,
      "real-001",
      {
        pair_id: input.pairId,
        status: "running",
        user_prompt: "Exercise the real SSE transport.",
      },
    ));
    response.write(sseEvent(
      "psychiatrist.process.delta",
      input.turnId,
      "real-002",
      { pair_id: input.pairId, text: "Real SSE process update." },
    ));
    response.write(sseEvent(
      "psychiatrist.answer.delta",
      input.turnId,
      "real-003",
      { pair_id: input.pairId, text: "Real SSE partial answer." },
    ));
  });
  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => reject(error);
    server.once("error", handleError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", handleError);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Controlled Psychiatrist SSE server did not bind a TCP port.");
  }
  const origin = `http://127.0.0.1:${address.port}`;
  const eventPath = `/api/memories/${READER_MEMORY_ID}/psychiatrist/threads/thread-e2e` +
    `/turns/${input.turnId}/events?variant_kind=source`;
  return {
    clientClosed: () => clientClosed,
    close: async () => {
      activeResponse?.destroy();
      if (!server.listening) {
        return;
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
      });
    },
    eventUrl: origin + eventPath,
    origin,
    requestedUrls,
    sendMalformedTerminalAndClose: () => {
      if (activeResponse === undefined || clientClosed) {
        throw new Error("Controlled Psychiatrist SSE response is not open.");
      }
      activeResponse.write(sseEvent(
        "psychiatrist.answer.completed",
        input.turnId,
        "real-004",
        {
          pair_id: input.pairId,
          text: 42,
        },
      ));
      activeResponse.end();
    },
  };
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

test("preserves right-rail tab and scroll state while toggling a Moment", async ({
  page,
}) => {
  createReaderFixture();
  await page.setViewportSize({ width: 1440, height: 700 });

  await page.goto(`/memories/${TOC_SCROLL_MEMORY_ID}`);
  await waitForReaderReady(page);

  const rightRailScroll = page.locator(".trauma-shell-right-rail > div");
  const toc = page.getByRole("navigation", { name: "Table of contents" });
  const tocScroll = toc.locator("ol");
  const allTab = page.getByRole("button", { exact: true, name: "All" });
  await allTab.click();
  await expect(allTab).toHaveAttribute("aria-pressed", "true");

  const before = await page.evaluate(() => {
    const rightRail = document.querySelector<HTMLElement>(
      ".trauma-shell-right-rail > div",
    );
    const tocList = document.querySelector<HTMLElement>(
      'nav[aria-label="Table of contents"] ol',
    );
    if (rightRail === null || tocList === null) {
      throw new Error("Reader right-rail scroll containers are missing");
    }
    rightRail.scrollTop = Math.min(80, rightRail.scrollHeight - rightRail.clientHeight);
    tocList.scrollTop = Math.min(120, tocList.scrollHeight - tocList.clientHeight);
    return {
      rightRail: rightRail.scrollTop,
      toc: tocList.scrollTop,
    };
  });
  expect(before.rightRail).toBeGreaterThan(0);
  expect(before.toc).toBeGreaterThan(0);

  const createResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/moments") &&
      response.request().method() === "POST",
  );
  await toc
    .getByRole("button", { name: "Moment Section 20" })
    .evaluate((button: HTMLButtonElement) => button.click());
  expect((await createResponse).status()).toBe(201);
  await expect(
    toc.getByRole("button", { name: "Moment Section 20" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(allTab).toHaveAttribute("aria-pressed", "true");

  const after = {
    rightRail: await rightRailScroll.evaluate((element) => element.scrollTop),
    toc: await tocScroll.evaluate((element) => element.scrollTop),
  };
  expect(Math.abs(after.rightRail - before.rightRail)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.toc - before.toc)).toBeLessThanOrEqual(1);
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

test("creates a Moment from the keyboard-operable selection toolbar", async ({
  page,
}) => {
  createReaderFixture();

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  await selectReaderSection(page, "details");

  const toolbar = page.getByRole("toolbar", {
    name: "Reader text selection actions",
  });
  const flashbackButton = toolbar.getByRole("button", {
    name: "Flashback selection",
  });
  const momentButton = toolbar.getByRole("button", {
    name: "Moment selected section",
  });
  await expect(flashbackButton).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(momentButton).toBeFocused();
  await page.keyboard.press("Home");
  await expect(flashbackButton).toBeFocused();
  await page.keyboard.press("End");
  await expect(momentButton).toBeFocused();

  const createResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/moments") &&
      response.request().method() === "POST",
  );
  await momentButton.click();

  const response = await createResponse;
  expect(response.status(), await response.text()).toBe(201);
  expect(readMomentAnchors()).toContain("details");
});

test("keeps Space from scrolling before opening the selected-text toolbar on keyup", async ({
  page,
}) => {
  createReaderFixture();

  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await waitForReaderReady(page);
  const readerContent = page.locator("[data-reader-content]");
  const selectedText =
    "Reader spacer paragraph 8 keeps lower anchors below the first viewport.";
  await readerContent.focus();
  await readerContent.getByText(selectedText, { exact: true }).scrollIntoViewIfNeeded();
  await setReaderTextSelection(page, selectedText, false);

  const initialScrollY = await page.evaluate(() => Math.round(window.scrollY));
  expect(initialScrollY).toBeGreaterThan(0);
  const toolbar = page.getByRole("toolbar", {
    name: "Reader text selection actions",
  });
  await expect(toolbar).toHaveCount(0);

  await page.keyboard.down(" ");
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(initialScrollY);
  await expect(toolbar).toHaveCount(0);

  await page.keyboard.up(" ");
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toHaveCount(1);
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
          database.exec("PRAGMA busy_timeout = 5000");
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
  await setReaderTextSelection(page, text, true);
}

async function setReaderTextSelection(
  page: Page,
  text: string,
  notifyReader: boolean,
) {
  await waitForReaderReady(page);
  await page.locator("[data-reader-content]").evaluate((root, input) => {
    const { notifyReader, selectedText } = input;
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
    if (notifyReader) {
      root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    }
  }, { notifyReader, selectedText: text });
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
