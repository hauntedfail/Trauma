import { watch } from "node:fs/promises";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  inspectE2ePersistenceState,
  resetE2eFixture,
} from "./bun-fixture";

const SUCCESS_URL = "https://success.import.trauma.invalid/article";
const FALLBACK_URL = "https://fallback.import.trauma.invalid/unavailable";
const E2E_ROOT = join(process.cwd(), ".trauma/e2e");

test.describe.configure({ mode: "serial" });

test("adds an extracted memory through the public composer and persists every store boundary", async ({
  page,
}) => {
  await resetAddMemoryFixture();

  const memory = await addMemoryThroughComposer(page, SUCCESS_URL);

  await expect(page).toHaveURL(new RegExp(`/memories/${memory.id}$`));
  await expect(
    page.getByRole("heading", { name: "Deterministic Import Article" }),
  ).toBeVisible();
  await expect(
    page.getByText("Fixture extraction stays deterministic without external network access."),
  ).toBeVisible();

  const persisted = await waitForCompletedPersistence(memory.id);
  expect(persisted).toMatchObject({
    backupStatus: "success",
    commitCount: 1,
    contentPath: `memories/${memory.id}/CONTENT.md`,
    extractionError: null,
    extractionStatus: "success",
    gitStatus: "",
    id: memory.id,
    title: "Deterministic Import Article",
    url: SUCCESS_URL,
  });
  expect(persisted.commitMessage).toBe(`e2e created memory ${memory.id}`);
  expect(persisted.fileContent).toContain('extraction_status: "success"');
  expect(persisted.fileContent).toContain(
    "Fixture extraction stays deterministic without external network access.",
  );
  expect(persisted.trackedContent).toBe(persisted.fileContent);
});

test("persists a link-only memory when the deterministic import response fails", async ({
  page,
}) => {
  await resetAddMemoryFixture();

  const memory = await addMemoryThroughComposer(page, FALLBACK_URL);

  await expect(page).toHaveURL(new RegExp(`/memories/${memory.id}$`));
  await expect(
    page.getByRole("heading", { name: "fallback.import.trauma.invalid" }),
  ).toBeVisible();
  await expect(
    page.locator("[data-reader-content]").getByRole("link", { name: FALLBACK_URL }),
  ).toBeVisible();

  const persisted = await waitForCompletedPersistence(memory.id);
  expect(persisted).toMatchObject({
    backupStatus: "success",
    commitCount: 1,
    contentPath: `memories/${memory.id}/CONTENT.md`,
    extractionError: "fetch failed: HTTP 503",
    extractionStatus: "link_only",
    gitStatus: "",
    id: memory.id,
    title: "fallback.import.trauma.invalid",
    url: FALLBACK_URL,
  });
  expect(persisted.commitMessage).toBe(`e2e created memory ${memory.id}`);
  expect(persisted.fileContent).toContain('extraction_status: "link_only"');
  expect(persisted.fileContent).toContain(`[${FALLBACK_URL}](<${FALLBACK_URL}>)`);
  expect(persisted.trackedContent).toBe(persisted.fileContent);
});

test("captures via a key, icon button, and palette into Shelf without ever opening a taxonomy prompt (AC 3)", async ({
  page,
}) => {
  await resetAddMemoryFixture();
  await page.goto("/memories");
  await expect(
    page.locator('.trauma-shell-frame[data-shell-hydrated="true"]'),
  ).toBeVisible();

  // 1. Capture via `a` key -> opens URL-only capture palette, no category/tag prompt
  await page.keyboard.press("a");
  const paletteDialog = page.getByRole("dialog", { name: "Command palette" });
  await expect(paletteDialog).toBeVisible();
  await expect(paletteDialog.getByLabel("URL to capture")).toBeVisible();
  await expect(paletteDialog.getByText(/categor|tag/i)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(paletteDialog).toHaveCount(0);

  // 2. Capture via left-rail Add icon button -> URL-only popover, no category/tag prompt
  await page.getByRole("button", { name: "Add memory" }).click();
  const composerDialog = page.getByRole("dialog", { name: "Add memory" });
  await expect(composerDialog).toBeVisible();
  await expect(composerDialog.getByLabel("URL")).toBeVisible();
  await expect(composerDialog.getByText(/categor|tag/i)).toHaveCount(0);

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/memories") &&
      response.request().method() === "POST",
  );
  await composerDialog.getByLabel("URL").fill(SUCCESS_URL);
  await composerDialog.getByLabel("URL").press("Enter");

  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const payload = (await response.json()) as {
    memory?: { id?: string; triageState?: string };
  };
  expect(payload.memory?.triageState).toBe("shelf");
  await expect(page.getByRole("dialog", { name: /category|tag/i })).toHaveCount(0);
});

async function addMemoryThroughComposer(page: Page, url: string) {
  await page.goto("/memories");
  await page.getByRole("button", { name: "Add memory" }).click();

  const composer = page.getByRole("dialog", { name: "Add memory" });
  await expect(composer).toBeVisible();
  await composer.getByLabel("URL").fill(url);

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/memories") &&
      response.request().method() === "POST",
  );
  await composer.getByLabel("URL").press("Enter");

  const response = await responsePromise;
  expect(response.status()).toBe(201);
  return readCreatedMemory(await response.json());
}

function readCreatedMemory(payload: unknown): { id: string } {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("memory" in payload) ||
    typeof payload.memory !== "object" ||
    payload.memory === null ||
    !("id" in payload.memory) ||
    typeof payload.memory.id !== "string"
  ) {
    throw new Error("Add Memory response did not include a memory id");
  }

  return { id: payload.memory.id };
}

async function resetAddMemoryFixture(): Promise<void> {
  await resetE2eFixture("backup_git");
}

async function waitForCompletedPersistence(memoryId: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const databaseChanges = watch(join(E2E_ROOT, "runtime"), {
    signal: controller.signal,
  });

  try {
    let state = await readPersistenceState(memoryId);
    if (isCompletedPersistence(state)) {
      return state;
    }

    for await (const _event of databaseChanges) {
      state = await readPersistenceState(memoryId);
      if (isCompletedPersistence(state)) {
        return state;
      }
    }
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Timed out waiting for backup persistence for ${memoryId}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }

  throw new Error(`Backup persistence watcher ended before ${memoryId} completed`);
}

interface PersistenceState {
  backupStatus: string | null;
  commitCount: number;
  commitMessage: string | null;
  contentPath: string | null;
  extractionError: string | null;
  extractionStatus: string | null;
  fileContent: string | null;
  gitStatus: string | null;
  id: string | null;
  title: string | null;
  trackedContent: string | null;
  url: string | null;
}

function isCompletedPersistence(state: PersistenceState) {
  return (
    state.backupStatus === "success" &&
    state.commitCount === 1 &&
    state.fileContent !== null &&
    state.fileContent === state.trackedContent &&
    state.gitStatus === ""
  );
}

async function readPersistenceState(memoryId: string): Promise<PersistenceState> {
  return inspectE2ePersistenceState(memoryId);
}
