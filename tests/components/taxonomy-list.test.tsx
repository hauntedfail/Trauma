import { renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import {
  TaxonomyList,
  type TaxonomyListItem,
} from "../../src/components/taxonomy/TaxonomyList";

const items = [
  { id: "category-research", name: "Research", memoryCount: 2 },
  { id: "category-ops", name: "Operations" },
] satisfies TaxonomyListItem[];

describe("taxonomy list", () => {
  it("renders chip mode without counts when count is absent", () => {
    const html = renderToString(() =>
      <TaxonomyList items={items} kind="category" mode="chips" />,
    );

    expect(html).toContain("Research");
    expect(html).toContain("Operations");
    expect(html).not.toContain("2 memories");
  });

  it("renders filter mode counts when provided", () => {
    const html = renderToString(() =>
      <TaxonomyList items={items} kind="category" mode="filters" />,
    );

    expect(html).toContain("Research");
    expect(html).toContain("2 memories");
    expect(html).toContain("Operations");
    expect(html).not.toContain("undefined memories");
  });

  it("marks the active filter as pressed", () => {
    const html = renderToString(() =>
      <TaxonomyList
        activeId="category-research"
        items={items}
        kind="category"
        mode="filters"
        onSelect={() => {}}
      />,
    );

    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
  });

  it("renders the supplied empty state", () => {
    const html = renderToString(() =>
      <TaxonomyList
        emptyLabel="No tags yet"
        items={[]}
        kind="tag"
        mode="filters"
      />,
    );

    expect(html).toContain("No tags yet");
  });

  it("wires click handlers with the selected item", () => {
    const html = renderToString(() =>
      <TaxonomyList
        items={[{ id: "tag-sqlite", name: "sqlite" }]}
        kind="tag"
        mode="filters"
        onSelect={() => {}}
      />,
    );

    expect(html).toContain("sqlite");
    expect(html).toContain("type=\"button\"");
  });
});
