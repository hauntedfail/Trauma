import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import {
  CheckIcon,
  ChevronLeftIcon,
  OpenIcon,
  PlusIcon,
  SearchIcon,
  TraumaNavIcons,
} from "../../src/components/icons";

describe("TRAUMA icon system", () => {
  it("exports outline and filled nav icon variants", () => {
    for (const name of [
      "memories",
      "highlights",
      "categories",
      "tags",
      "backup",
      "settings",
    ] as const) {
      expect(TraumaNavIcons[name].outline).toBeDefined();
      expect(TraumaNavIcons[name].filled).toBeDefined();
    }
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
});
