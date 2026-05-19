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
    expect(routeHeaderSource).toContain("min-h-[3.5rem]");
    expect(routeHeaderSource).toContain("text-[20px] font-bold");
    expect(routeHeaderSource).not.toContain("text-3xl");
    expect(routeHeaderSource).not.toContain("py-6");
    expect(routeHeaderSource).toContain("items-center gap-3");
    expect(routeHeaderSource).toContain("grid-cols-[minmax(0,1fr)_auto]");
    expect(routeHeaderSource).toContain("leading");
    expect(routeHeaderSource).toContain("metadata");
    expect(routeHeaderSource).toContain("actions");
  });

  it("keeps the memory reader previous button aligned with the route title", () => {
    expect(memoryReaderSource).toContain('title="Memory"');
    expect(memoryReaderSource).toContain("grid size-10 place-items-center");
    expect(memoryReaderSource).not.toContain("mt-1 grid size-10");
    expect(memoryReaderSource).not.toContain("titleClass=");
  });

  it("keeps route header title sizing centralised", () => {
    expect(memoryReaderSource).not.toContain("text-[20px] font-bold text-trauma-text-primary");
    expect(settingsPageSource).not.toContain("text-[32px] font-extrabold");
    expect(settingsPageSource).not.toContain("titleClass=");
    expect(momentBrowseSource).not.toContain("titleClass=");
    expect(flashbacksRouteSource).not.toContain("titleClass=");
  });

  it("keeps route pages on shared header chrome unless they own route-specific tabs", () => {
    for (const source of [
      memoryReaderSource,
      momentBrowseSource,
      flashbacksRouteSource,
      settingsPageSource,
    ]) {
      expect(source).toContain("RouteHeader");
    }

    expect(memoryBrowseSource).toContain("MemoryReadStateTabs");
    expect(memoryBrowseSource).not.toContain("RouteHeader");

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
