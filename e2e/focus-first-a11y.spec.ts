import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { materializeE2eFixture, resetE2eFixture } from "./bun-fixture";

const READER_MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f101";

// Overlays fade in over 150 ms (opacity and transform). axe-core measures the
// colors on screen at the instant it runs, so a scan started mid-fade reports
// the blended colors of an unfinished frame. Wait for every finite animation
// to settle so the scan sees the surface as the reader sees it.
async function waitForRunningAnimationsToSettle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finiteAnimations = document.getAnimations().filter((animation) => {
      const endTime = animation.effect?.getComputedTiming().endTime;
      return typeof endTime === "number" && Number.isFinite(endTime);
    });
    await Promise.allSettled(
      finiteAnimations.map((animation) => animation.finished),
    );
  });
}

async function assertNoSeriousOrCriticalA11yViolations(
  page: Page,
  surfaceName: string,
): Promise<void> {
  await waitForRunningAnimationsToSettle(page);
  const results = await new AxeBuilder({ page }).analyze();
  const blockingViolations = results.violations.filter(
    (violation) =>
      violation.impact === "serious" || violation.impact === "critical",
  );

  expect(
    blockingViolations,
    `Expected zero serious/critical axe-core violations on ${surfaceName}, found:\n${JSON.stringify(
      blockingViolations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          failureSummary: n.failureSummary,
        })),
      })),
      null,
      2,
    )}`,
  ).toEqual([]);
}

test.describe.configure({ mode: "serial" });

test("Today lane has zero serious or critical axe-core violations (AC 10)", async ({
  page,
}) => {
  await resetE2eFixture("read_only");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/memories");
  await expect(
    page.getByRole("heading", { name: "Today", exact: true }),
  ).toBeVisible();

  await assertNoSeriousOrCriticalA11yViolations(page, "Today (/memories)");
});

test("Shelf lane has zero serious or critical axe-core violations (AC 10)", async ({
  page,
}) => {
  await resetE2eFixture("read_only");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/memories?lane=shelf");
  await expect(
    page.getByRole("heading", { name: "Shelf", exact: true }),
  ).toBeVisible();

  await assertNoSeriousOrCriticalA11yViolations(
    page,
    "Shelf (/memories?lane=shelf)",
  );
});

test("Library lane has zero serious or critical axe-core violations (AC 10)", async ({
  page,
}) => {
  await resetE2eFixture("read_only");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/memories?lane=library");
  await expect(
    page.getByRole("heading", { name: "Library", exact: true }),
  ).toBeVisible();

  await assertNoSeriousOrCriticalA11yViolations(
    page,
    "Library (/memories?lane=library)",
  );
});

test("Reader has zero serious or critical axe-core violations with micro-surfaces closed and open (AC 10)", async ({
  page,
}) => {
  await materializeE2eFixture("reader_base");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await expect(page.locator("[data-reader-content]")).toHaveAttribute(
    "data-reader-ready",
    "true",
  );
  await expect(page.locator("#reader-psychiatrist-sheet")).toHaveCount(0);
  await expect(page.locator("#reader-translate-popover")).toHaveCount(0);
  await expect(page.locator("#reader-details-popover")).toHaveCount(0);

  await assertNoSeriousOrCriticalA11yViolations(
    page,
    "Reader (micro-surfaces closed)",
  );

  await page.locator("[data-reader-details-trigger]").click();
  await expect(page.locator("#reader-details-popover")).toBeVisible();
  await assertNoSeriousOrCriticalA11yViolations(
    page,
    "Reader (Details popover open)",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator("#reader-details-popover")).toHaveCount(0);

  await page.locator("[data-reader-translate-trigger]").click();
  await expect(page.locator("#reader-translate-popover")).toBeVisible();
  await assertNoSeriousOrCriticalA11yViolations(
    page,
    "Reader (Translate popover open)",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator("#reader-translate-popover")).toHaveCount(0);

  await page.keyboard.press("]");
  await expect(page.locator("#reader-psychiatrist-sheet")).toBeVisible();
  await assertNoSeriousOrCriticalA11yViolations(
    page,
    "Reader (Psychiatrist sheet open)",
  );
});

test("prefers-reduced-motion disables reader psychiatrist sheet, topbar, landmark rail, and shell rail transitions", async ({
  page,
}) => {
  await materializeE2eFixture("reader_base");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/memories/${READER_MEMORY_ID}`);
  await expect(page.locator("[data-reader-content]")).toHaveAttribute(
    "data-reader-ready",
    "true",
  );
  await page.keyboard.press("]");
  await expect(page.locator("#reader-psychiatrist-sheet")).toBeVisible();

  const durations = await page.evaluate(() => {
    const read = (selector: string) => {
      const el = document.querySelector(selector);
      return el ? getComputedStyle(el).transitionDuration : null;
    };
    return {
      leftRail: read(".trauma-shell-left-rail"),
      topbar: read(".trauma-reader-topbar"),
      landmarkRail: read(".trauma-reader-landmark-rail"),
      psychiatristSheet: read(".trauma-reader-psychiatrist-sheet"),
    };
  });

  expect(durations.leftRail).toBe("0s");
  expect(durations.topbar).toBe("0s");
  expect(durations.psychiatristSheet).toBe("0s");
  if (durations.landmarkRail !== null) {
    expect(durations.landmarkRail).toBe("0s");
  }
});
