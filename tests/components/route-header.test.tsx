import { existsSync, readFileSync } from "node:fs";

import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import { RouteHeader } from "../../src/components/layout/RouteHeader";

const routeHeaderPath = "src/components/layout/RouteHeader.tsx";
const routeHeaderSource = existsSync(routeHeaderPath)
  ? readFileSync(routeHeaderPath, "utf8")
  : "";
const memoryBrowseSource = readFileSync(
  "src/components/memories/MemoryBrowse.tsx",
  "utf8",
);
const memoryReaderSource = readFileSync(
  "src/components/reader/MemoryReader.tsx",
  "utf8",
);
const momentBrowseSource = readFileSync(
  "src/components/moments/MomentBrowse.tsx",
  "utf8",
);
const flashbacksRouteSource = readFileSync(
  "src/routes/flashbacks/index.tsx",
  "utf8",
);
const settingsPageSource = readFileSync(
  "src/components/settings/SettingsPage.tsx",
  "utf8",
);

describe("route header", () => {
  it("renders title, optional leading content, metadata, and actions from one component", () => {
    const html = renderToString(() =>
      createComponent(RouteHeader, {
        actions: <button type="button">Action</button>,
        class: "custom-route-header",
        leading: () => <a href="/memories">Back</a>,
        metadata: <span>https://example.com</span>,
        title: "Memory",
        titleElement: "p",
      }),
    );

    expect(html).toContain("trauma-route-header");
    expect(html).toContain("custom-route-header");
    expect(html).toContain(">Back<");
    expect(html).toContain(">Memory<");
    expect(html).toContain(">https://example.com<");
    expect(html).toContain(">Action<");
    expect(html).toContain("<p");
    expect(html).not.toContain("<h1");
  });

  it("owns the shared sticky header chrome and split layout", () => {
    expect(routeHeaderSource).toContain("trauma-route-header");
    expect(routeHeaderSource).toContain("trauma-fluid-route-padding");
    expect(routeHeaderSource).toContain("sticky top-0");
    expect(routeHeaderSource).toContain("grid-cols-[minmax(0,1fr)_auto]");
    expect(routeHeaderSource).toContain("leading");
    expect(routeHeaderSource).toContain("metadata");
    expect(routeHeaderSource).toContain("actions");
  });

  it("keeps route pages on the shared header instead of defining local chrome", () => {
    for (const source of [
      memoryBrowseSource,
      memoryReaderSource,
      momentBrowseSource,
      flashbacksRouteSource,
      settingsPageSource,
    ]) {
      expect(source).toContain("RouteHeader");
    }

    for (const source of [
      memoryBrowseSource,
      momentBrowseSource,
      flashbacksRouteSource,
      settingsPageSource,
    ]) {
      expect(source).not.toContain("const pageHeader =");
      expect(source).not.toContain("const headerClass =");
    }
  });
});
