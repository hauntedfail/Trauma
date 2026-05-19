import { readFileSync } from "node:fs";

import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import {
  findTaxonomyOptionByName,
  isTaxonomyNameAttached,
  normalizeTaxonomyAddName,
  sortTaxonomyOptionsByRecentUse,
  TaxonomyAddControl,
} from "../../src/components/memories/TaxonomyAddControl";
import type { BrowseTaxonomySummaryItem } from "../../src/components/memories/browse-data";

const taxonomyAddControlSource = readFileSync(
  "src/components/memories/TaxonomyAddControl.tsx",
  "utf8",
);
const inlineCreateSource = readFileSync(
  "src/components/memories/TaxonomyInlineCreateControl.tsx",
  "utf8",
);

const taxonomyOptions = [
  {
    id: "unused",
    name: "unused",
    memoryCount: 0,
    lastAssignedAt: null,
  },
  {
    id: "older",
    name: "older",
    memoryCount: 1,
    lastAssignedAt: "2026-05-01T10:00:00.000Z",
  },
  {
    id: "recent",
    name: "recent",
    memoryCount: 2,
    lastAssignedAt: "2026-05-12T10:00:00.000Z",
  },
  {
    id: "same-time-alpha",
    name: "alpha",
    memoryCount: 3,
    lastAssignedAt: "2026-05-12T10:00:00.000Z",
  },
] satisfies BrowseTaxonomySummaryItem[];

describe("taxonomy add control", () => {
  it("orders selectable taxonomy by recent assignment before count or creation concerns", () => {
    expect(sortTaxonomyOptionsByRecentUse(taxonomyOptions).map((item) => item.id)).toEqual([
      "same-time-alpha",
      "recent",
      "older",
      "unused",
    ]);
  });

  it("normalizes inline-created names by trimming whitespace", () => {
    expect(normalizeTaxonomyAddName("  sqlite  ")).toBe("sqlite");
    expect(normalizeTaxonomyAddName("   ")).toBe("");
  });

  it("resolves inline-created names to existing options before creation", () => {
    expect(findTaxonomyOptionByName(taxonomyOptions, " RECENT ")?.id).toBe(
      "recent",
    );
    expect(findTaxonomyOptionByName(taxonomyOptions, "missing")).toBeUndefined();
  });

  it("detects attached taxonomy by normalized name as well as id", () => {
    expect(
      isTaxonomyNameAttached(
        [{ id: "tag-attached", name: "Harness-Engineering" }],
        {
          id: "tag-duplicate",
          name: "harness-engineering",
          memoryCount: 1,
          lastAssignedAt: null,
        },
      ),
    ).toBe(true);
  });

  it("renders the existing Add pill style as the stable trigger surface", () => {
    const html = renderToString(() =>
      createComponent(TaxonomyAddControl, {
        attachedItems: [],
        id: "taxonomy-add-test",
        kind: "tag",
        options: taxonomyOptions,
        onAttachName: () => {},
      }),
    );

    expect(html).toContain("Add tag");
    expect(html).toContain('title="Add tag"');
    expect(html).toContain("border-dashed");
    expect(html).toContain("text-trauma-text-muted");
    expect(html).toContain("data-taxonomy-create-trigger");
  });

  it("keeps New distinct from Add and leaves inline input visually unadorned", () => {
    expect(taxonomyAddControlSource).toContain("New tag");
    expect(taxonomyAddControlSource).toContain("New category");
    expect(taxonomyAddControlSource).toContain("onClick={(event) => enterInlineInput(event)}");
    expect(taxonomyAddControlSource).toContain(
      "findTaxonomyOptionByName(props.options, name)",
    );
    expect(inlineCreateSource).toContain('event.key === "Escape"');
    expect(taxonomyAddControlSource).not.toContain("placeholder=");
    expect(taxonomyAddControlSource).not.toContain("focus:ring");
    expect(taxonomyAddControlSource).toContain("validateTagName");
  });

  it("keeps existing taxonomy selection open for repeated assignment", () => {
    expect(taxonomyAddControlSource).toContain("void attachExistingOption(option)");
    expect(taxonomyAddControlSource).not.toContain("setPopoverOpen(false);\\n      await props.onAttachName(option.name)");
  });

  it("treats attached options as detach operations when a detach handler exists", () => {
    expect(taxonomyAddControlSource).toContain("onDetachName");
    expect(taxonomyAddControlSource).toContain("void detachExistingOption(option)");
    expect(taxonomyAddControlSource).toContain("isTaxonomyNameAttached");
  });
});
