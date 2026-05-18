import { readFileSync } from "node:fs";

import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import {
  normalizeTaxonomyName,
  submitTaxonomyName,
  TaxonomyCreatePopover,
} from "../../src/components/memories/TaxonomyCreatePopover";

const taxonomyCreatePopoverSource = readFileSync(
  "src/components/memories/TaxonomyCreatePopover.tsx",
  "utf8",
);

describe("taxonomy create popover", () => {
  it("renders labelled input and submit action", () => {
    const html = renderToString(() =>
      createComponent(TaxonomyCreatePopover, {
        title: "New tag",
        label: "Tag name",
        placeholder: "sqlite",
        submitLabel: "Create tag",
        onSubmitName: () => {},
        onClose: () => {},
      }),
    );

    expect(html).toContain("New tag");
    expect(html).toContain("Tag name");
    expect(html).toContain("sqlite");
    expect(html).toContain("Create tag");
  });

  it("normalizes names by trimming surrounding whitespace", () => {
    expect(normalizeTaxonomyName(" sqlite ")).toBe("sqlite");
  });

  it("rejects empty names before calling submit", async () => {
    const calls: string[] = [];

    await expect(
      submitTaxonomyName({
        name: "   ",
        onSubmitName: (name) => {
          calls.push(name);
        },
      }),
    ).rejects.toThrow("name must be a non-empty string");
    expect(calls).toEqual([]);
  });

  it("submits trimmed names", async () => {
    const calls: string[] = [];

    await submitTaxonomyName({
      name: " Research ",
      onSubmitName: (name) => {
        calls.push(name);
      },
    });

    expect(calls).toEqual(["Research"]);
  });

  it("uses shared outside-click dismissal without action-target exceptions", () => {
    expect(taxonomyCreatePopoverSource).toContain("useDismissableLayer");
    expect(taxonomyCreatePopoverSource).not.toContain(
      "isTaxonomyPopoverActionTarget",
    );
    expect(taxonomyCreatePopoverSource).not.toContain(
      "shouldSuppressOutsideTaxonomyClick",
    );
  });
});
