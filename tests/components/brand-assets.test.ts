import { existsSync, readFileSync } from "node:fs";

import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import { TraumaMark } from "../../src/components/brand/TraumaMark";

describe("TRAUMA brand assets", () => {
  it("ships the refined mark assets in the public tree", () => {
    expect(existsSync("public/assets/trauma-mark.svg")).toBe(true);
    expect(existsSync("public/assets/trauma-mark.png")).toBe(true);
    expect(existsSync("public/favicon.ico")).toBe(true);
  });

  it("uses the favicon in the app metadata", () => {
    const appSource = readFileSync("src/app.tsx", "utf8");

    expect(appSource).toContain('rel="icon"');
    expect(appSource).toContain("/favicon.ico");
  });

  it("renders the existing decorative PNG mark without changing brand chrome", () => {
    const html = renderToString(() =>
      createComponent(TraumaMark, { class: "brand-mark", size: 36 }),
    );

    expect(html).not.toContain("<picture");
    expect(html).not.toContain("<source");
    expect(html).not.toContain('srcset="/assets/trauma-mark.svg"');
    expect(html).toContain('src="/assets/trauma-mark.png"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toMatch(/\salt(=("|'')?)?\s/);
    expect(html).toContain("brand-mark");
    expect(html).toContain('width="36"');
    expect(html).toContain('height="36"');
  });
});
