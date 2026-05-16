import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import {
  CheckIcon,
  ChevronLeftIcon,
  HermesIcon,
  MoonIcon,
  OpenIcon,
  PageIcon,
  PaperIcon,
  PlusIcon,
  SearchIcon,
  SunIcon,
  TraumaNavIcons,
} from "../../src/components/icons";

describe("TRAUMA icon system", () => {
  it("exports outline and filled nav icon variants", () => {
    for (const name of [
      "memories",
      "flashbacks",
      "moment",
      "categories",
      "tags",
      "backup",
      "settings",
    ] as const) {
      expect(TraumaNavIcons[name].outline).toBeDefined();
      expect(TraumaNavIcons[name].filled).toBeDefined();
      expect(typeof TraumaNavIcons[name].outline).toBe("function");
      expect(typeof TraumaNavIcons[name].filled).toBe("function");
    }
  });

  it("creates fresh nav icon elements for each insertion point", () => {
    const first = TraumaNavIcons.memories.outline();
    const second = TraumaNavIcons.memories.outline();

    expect(first).not.toBe(second);
    expect(renderToString(() => first)).toContain('aria-hidden="true"');
    expect(renderToString(() => second)).toContain('aria-hidden="true"');
  });

  it("renders the Flashbacks nav icon as a lightning mark", () => {
    const outline = renderToString(() => TraumaNavIcons.flashbacks.outline());
    const filled = renderToString(() => TraumaNavIcons.flashbacks.filled());

    expect(outline).toContain("M15 2 6 14h6l-1 10 9-13h-6l1-9z");
    expect(filled).toContain("M15 2 6 14h6l-1 10 9-13h-6l1-9z");
    expect(outline).not.toContain("M4 22h18");
  });

  it("renders utility icons with currentColor and hidden SVG semantics", () => {
    const icons = [
      ChevronLeftIcon,
      SearchIcon,
      PlusIcon,
      OpenIcon,
      CheckIcon,
    ];

    for (const Icon of icons) {
      const html = renderToString(() => createComponent(Icon, { size: 24 }));
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain("currentColor");
      expect(html).toContain('width="24"');
      expect(html).toContain('height="24"');
    }
  });

  it("keeps theme box utility icons aligned with the refined sample", () => {
    const sun = renderToString(() => createComponent(SunIcon, { size: 16 }));
    const moon = renderToString(() => createComponent(MoonIcon, { size: 16 }));
    const page = renderToString(() => createComponent(PageIcon, { size: 16 }));
    const paper = renderToString(() => createComponent(PaperIcon, { size: 16 }));

    expect(sun).toContain('x1="12"');
    expect(sun).toContain('y1="2"');
    expect(sun).toContain('y2="5"');
    expect(sun).toContain('x1="17.3"');
    expect(sun).toContain('y2="4.5"');
    expect(moon).toContain("M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z");
    expect(page).toContain('x="5"');
    expect(page).toContain('y="3"');
    expect(page).toContain('width="14"');
    expect(page).toContain('height="18"');
    expect(page).toContain('rx="1.5"');
    expect(paper).toContain("M5 3h9l5 5v13a0 0 0 0 1 0 0H5z");
    expect(paper).toContain("M14 3v5h5");
  });

  it("exports a Hermès surface icon as a shopping bag silhouette", () => {
    const html = renderToString(() => createComponent(HermesIcon, { size: 16 }));

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('width="16"');
    expect(html).toContain('height="16"');
    expect(html).toContain("currentColor");
    expect(html).toContain("M5 9h14v10.5H5z");
    expect(html).toContain("M8 9V7.7C8 4.7 9.7 2.5 12 2.5s4 2.2 4 5.2V9");
    expect(html).toContain("M9.6 9V7.9c0-2 1-3.4 2.4-3.4s2.4 1.4 2.4 3.4V9");
  });
});
