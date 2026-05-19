import { readFileSync } from "node:fs";

import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import {
  normalizeTaxonomyAddName,
  TaxonomyInlineCreateControl,
} from "../../src/components/memories/TaxonomyInlineCreateControl";

const inlineCreateSource = readFileSync(
  "src/components/memories/TaxonomyInlineCreateControl.tsx",
  "utf8",
);

describe("taxonomy inline create control", () => {
  it("renders the existing dashed taxonomy pill as the trigger surface", () => {
    const html = renderToString(() =>
      createComponent(TaxonomyInlineCreateControl, {
        label: "New tag",
        onSubmitName: () => {},
      }),
    );

    expect(html).toContain("New tag");
    expect(html).toContain("border-dashed");
    expect(html).toContain("text-trauma-text-muted");
    expect(html).toContain("data-taxonomy-create-trigger");
  });

  it("normalizes submitted names and keeps the input visually unadorned", () => {
    expect(normalizeTaxonomyAddName("  sqlite  ")).toBe("sqlite");
    expect(normalizeTaxonomyAddName("   ")).toBe("");
    expect(inlineCreateSource).toContain('event.key === "Escape"');
    expect(inlineCreateSource).not.toContain("placeholder=");
    expect(inlineCreateSource).not.toContain("focus:ring");
  });

  it("supports caller-supplied name validation before submission", () => {
    expect(inlineCreateSource).toContain("validateName");
    expect(inlineCreateSource).toContain("validationError");
  });
});
