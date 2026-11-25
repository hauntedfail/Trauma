import { expect, test, type Page } from "@playwright/test";

import { materializeE2eFixture } from "./bun-fixture";

const PAGINATION_MEMORY_ID = "018f04a2-3c6f-7c88-9a8b-8c99a9b7f177";
const PAGE_SIZE = 30;
const ARCHIVE_SIZE = 37;
const FLASHBACK_PAGE_QUERY_ID =
  "src_components_flashbacks_flashbacks-loader_ts--getFlashbackBrowsePage_query";
const MOMENT_PAGE_QUERY_ID =
  "src_components_moments_moments-loader_ts--getMomentBrowsePage_query";
const ROUTE_RETRY_SURFACES = [
  {
    failureTitle: "Failed to load flashbacks",
    navLabel: "Flashbacks",
    pageNavLabel: "Flashback pages",
    pathname: "/flashbacks",
    queryId: FLASHBACK_PAGE_QUERY_ID,
    regionName: "Flashback page results",
    retryName: "Retry flashbacks",
    retryingName: "Retrying flashbacks...",
    visibleFirstPageText: "Flashback selection 37",
  },
  {
    failureTitle: "Failed to load Moments",
    navLabel: "Moments",
    pageNavLabel: "Moment pages",
    pathname: "/moments",
    queryId: MOMENT_PAGE_QUERY_ID,
    regionName: "Moment page results",
    retryName: "Retry Moments",
    retryingName: "Retrying Moments...",
    visibleFirstPageText: "Moment Section 37",
  },
] as const;

test.describe.configure({ mode: "serial" });

test("paginates large Flashback and Moment archives through URL history", async ({
  page,
}) => {
  await seedLargeCollectionArchive();

  await page.goto("/flashbacks");
  await expectCollectionPage(page, PAGE_SIZE, "Flashback selection 37");
  await expect(page.getByText("Flashback selection 07", { exact: false })).toHaveCount(0);

  await page.getByRole("navigation", { name: "Flashback pages" })
    .getByRole("link", { name: "Next" })
    .click();
  await expect(page).toHaveURL(/\/flashbacks\?cursor=/);
  await expectCollectionPage(page, ARCHIVE_SIZE - PAGE_SIZE, "Flashback selection 07");
  await expect(page.getByText("Flashback selection 37", { exact: false })).toHaveCount(0);

  await page.reload();
  await expectCollectionPage(page, ARCHIVE_SIZE - PAGE_SIZE, "Flashback selection 07");
  await page.goBack();
  await expect(page).toHaveURL(/\/flashbacks$/);
  await expectCollectionPage(page, PAGE_SIZE, "Flashback selection 37");

  await page.goto("/moments");
  await expect(page).toHaveTitle("Moments | TRAUMA");
  await expect(
    page.getByRole("heading", { name: "Moments", exact: true }),
  ).toBeVisible();
  await expectCollectionPage(page, PAGE_SIZE, "Moment Section 37");
  await expect(page.getByText("Moment Section 07", { exact: true })).toHaveCount(0);

  await page.getByRole("navigation", { name: "Moment pages" })
    .getByRole("link", { name: "Next" })
    .click();
  await expect(page).toHaveURL(/\/moments\?cursor=/);
  await expectCollectionPage(page, ARCHIVE_SIZE - PAGE_SIZE, "Moment Section 07");
  await expect(page.getByText("Moment Section 37", { exact: true })).toHaveCount(0);

  await page.reload();
  await expectCollectionPage(page, ARCHIVE_SIZE - PAGE_SIZE, "Moment Section 07");
  await page.goBack();
  await expect(page).toHaveURL(/\/moments$/);
  await expectCollectionPage(page, PAGE_SIZE, "Moment Section 37");
});

test("keeps Reader Landmark Rail Marks in one bounded scrollable panel", async ({
  page,
}) => {
  await seedLargeCollectionArchive();
  await page.setViewportSize({ width: 1440, height: 760 });

  await page.goto(`/memories/${PAGINATION_MEMORY_ID}`);
  await waitForReaderReady(page);
  const marksContainer = await openReaderLandmarkMarks(page);
  const flashbackSection = marksContainer.getByRole("region", {
    name: "Flashbacks",
  });

  await expect(flashbackSection.getByRole("link")).toHaveCount(ARCHIVE_SIZE);
  await expect(
    flashbackSection.getByText("Flashback selection 37", { exact: false }),
  ).toBeVisible();

  const scrollStyle = await marksContainer.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      maxHeight: style.maxHeight,
      overflowY: style.overflowY,
      overscrollBehaviorY: style.overscrollBehaviorY,
    };
  });
  expect(scrollStyle.maxHeight).not.toBe("none");
  expect(scrollStyle.overflowY).toBe("auto");
  expect(scrollStyle.overscrollBehaviorY).toBe("contain");
});

test("retries failed first Flashback and Moment pages without resetting the URL", async ({
  page,
}) => {
  await seedLargeCollectionArchive();

  for (const surface of ROUTE_RETRY_SURFACES) {
    await page.goto("/memories");
    const interception = await interceptCollectionPageRetry(page, surface.queryId);
    try {
      await page
        .getByRole("navigation", { name: "Primary sections" })
        .getByRole("link", { name: surface.navLabel })
        .click();

      const region = page.getByRole("region", { name: surface.regionName });
      const alert = region.getByRole("alert");
      await expect(alert.getByRole("heading", { name: surface.failureTitle }))
        .toBeVisible();
      expect(new URL(page.url()).pathname).toBe(surface.pathname);
      expect(new URL(page.url()).search).toBe("");

      const retry = alert.getByRole("button");
      await expect(retry).toHaveAccessibleName(surface.retryName);
      await retry.click();
      await expect.poll(interception.attempts).toBe(2);
      await expect(retry).toBeDisabled();
      await expect(retry).toHaveAccessibleName(surface.retryingName);
      await retry.evaluate((button: HTMLButtonElement) => button.click());

      interception.release();
      await expect(region.locator("[data-collection-row]")).toHaveCount(PAGE_SIZE);
      expect(interception.attempts()).toBe(2);
      expect(new URL(page.url()).pathname).toBe(surface.pathname);
      expect(new URL(page.url()).search).toBe("");
      await expect(region).toBeFocused();
    } finally {
      interception.release();
      await interception.remove();
    }
  }
});

for (const surface of ROUTE_RETRY_SURFACES) {
  test(`does not render an abandoned ${surface.navLabel} retry after navigating to First`, async ({
    page,
  }) => {
    await seedLargeCollectionArchive();
    await page.goto(surface.pathname);
    await expectCollectionPage(page, PAGE_SIZE, surface.visibleFirstPageText);
    const interception = await interceptCollectionPageRetry(page, surface.queryId);

    try {
      const pageNavigation = page.getByRole("navigation", {
        name: surface.pageNavLabel,
      });
      await pageNavigation.getByRole("link", { name: "Next" }).click();
      await expect(page).toHaveURL(new RegExp(`${surface.pathname}\\?cursor=`));

      const region = page.getByRole("region", { name: surface.regionName });
      await expect(region.getByRole("alert")).toBeVisible();
      const retry = region.getByRole("button");
      await retry.click();
      await expect.poll(interception.attempts).toBe(2);
      await expect(retry).toBeDisabled();

      await pageNavigation.getByRole("link", { name: "First" }).click();
      await expect.poll(() => new URL(page.url()).pathname).toBe(surface.pathname);
      expect(new URL(page.url()).search).toBe("");
      await expectCollectionPage(page, PAGE_SIZE, surface.visibleFirstPageText);
      await expect(region.getByRole("alert")).toHaveCount(0);

      await interception.releaseAndWait();
      expect(new URL(page.url()).search).toBe("");
      await expectCollectionPage(page, PAGE_SIZE, surface.visibleFirstPageText);
      await expect(region.getByRole("alert")).toHaveCount(0);
    } finally {
      interception.release();
      await interception.remove();
    }
  });
}

test("returns keyboard focus to Retry after repeated recovery failures", async ({
  page,
}) => {
  await seedLargeCollectionArchive();
  await page.goto("/memories");
  const interception = await interceptCollectionPageRetry(
    page,
    FLASHBACK_PAGE_QUERY_ID,
    { mode: "fail-all" },
  );

  try {
    await page
      .getByRole("navigation", { name: "Primary sections" })
      .getByRole("link", { name: "Flashbacks" })
      .click();
    const region = page.getByRole("region", { name: "Flashback page results" });
    const retry = region.getByRole("button");
    await expect(retry).toHaveAccessibleName("Retry flashbacks");

    for (const attempt of [2, 3]) {
      await retry.focus();
      await retry.press("Enter");
      await expect.poll(interception.attempts).toBe(attempt);
      await expect(retry).toHaveAccessibleName("Retry flashbacks");
      await expect(retry).toBeEnabled();
      await expect(retry).toBeFocused();
    }
  } finally {
    interception.release();
    await interception.remove();
  }
});

async function expectCollectionPage(
  page: Page,
  rowCount: number,
  visibleText: string,
): Promise<void> {
  await expect(page.locator("[data-collection-row]")).toHaveCount(rowCount);
  await expect(page.getByText(visibleText, { exact: false }).first()).toBeVisible();
}

async function waitForReaderReady(page: Page): Promise<void> {
  await expect(page.locator("[data-reader-content]")).toHaveAttribute(
    "data-reader-ready",
    "true",
  );
}

async function openReaderLandmarkMarks(page: Page) {
  const rail = page.locator("[data-reader-landmark-rail]");
  await expect(rail).toBeVisible();
  const marks = rail.locator("[data-reader-landmark-marks]");
  if ((await marks.count()) === 0) {
    await rail.hover();
  }
  await expect(marks).toBeVisible();
  return marks;
}

async function interceptCollectionPageRetry(
  page: Page,
  queryId: string,
  options: { mode?: "fail-all" | "hold-retry" } = {},
) {
  let requestAttempts = 0;
  let releaseRetryRequest: () => void = () => undefined;
  const retryRequestGate = new Promise<void>((resolve) => {
    releaseRetryRequest = resolve;
  });
  const matchesQuery = (url: URL): boolean =>
    url.pathname === "/_server/" && url.searchParams.get("id") === queryId;
  await page.route(matchesQuery, async (route) => {
    requestAttempts += 1;
    if (requestAttempts === 1 || options.mode === "fail-all") {
      await route.abort("failed");
      return;
    }

    if (requestAttempts === 2) {
      await retryRequestGate;
    }
    await route.continue();
  });

  return {
    attempts: () => requestAttempts,
    release: () => releaseRetryRequest(),
    releaseAndWait: async () => {
      const response = page.waitForResponse((candidate) =>
        matchesQuery(new URL(candidate.url()))
      );
      releaseRetryRequest();
      await response;
    },
    remove: () => page.unroute(matchesQuery),
  };
}

async function seedLargeCollectionArchive(): Promise<void> {
  await materializeE2eFixture("collection_archive");
}
