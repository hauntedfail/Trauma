import { readFileSync } from "node:fs";

import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import { MemoryReadStatusControl } from "../../src/components/memories/MemoryReadStatusControl";
import { KebabActionMenu } from "../../src/components/ui/KebabActionMenu";
import { SegmentedToggleButton } from "../../src/components/ui/SegmentedToggleButton";
import { WaxSealButton, WaxSealLabel } from "../../src/components/ui/WaxSealButton";

const tailwindSource = readFileSync("src/styles/tailwind.css", "utf8");
const addMemoryFormSource = readFileSync(
  "src/components/memories/AddMemoryForm.tsx",
  "utf8",
);
const appShellSource = readFileSync("src/components/shell/AppShell.tsx", "utf8");
const memoryBrowseSource = readFileSync(
  "src/components/memories/MemoryBrowse.tsx",
  "utf8",
);
const taxonomyAddControlSource = readFileSync(
  "src/components/memories/TaxonomyAddControl.tsx",
  "utf8",
);
const readerSource = readFileSync("src/components/reader/MemoryReader.tsx", "utf8");
const kebabActionMenuSource = readFileSync(
  "src/components/ui/KebabActionMenu.tsx",
  "utf8",
);
describe("button hover hints", () => {
  it("uses native HTML title tooltips and no custom tooltip styles", () => {
    expect(tailwindSource).not.toContain("[data-trauma-hint]");
    expect(tailwindSource).not.toContain(".trauma-button-hint");
    expect(tailwindSource).not.toContain("trauma-button-hint-in");
  });

  it("uses inverse action text for read-status button hints", () => {
    const readHtml = renderToString(() =>
      createComponent(MemoryReadStatusControl, {
        initialRead: true,
        memoryId: "memory-1",
        variant: "icon",
      }),
    );
    const unreadHtml = renderToString(() =>
      createComponent(MemoryReadStatusControl, {
        initialRead: false,
        memoryId: "memory-1",
        variant: "icon",
      }),
    );

    expect(readHtml).toContain('title="Mark as unread"');
    expect(unreadHtml).toContain('title="Mark as read"');
  });

  it("lets shared button primitives expose hints through native HTML title attributes", () => {
    const kebabHtml = renderToString(() =>
      createComponent(KebabActionMenu, {
        id: "memory-actions-test-menu",
        initialOpen: true,
        label: "Memory actions",
        children: () => <button type="button">Action</button>,
      }),
    );
    const segmentedHtml = renderToString(() =>
      createComponent(SegmentedToggleButton, {
        active: true,
        hint: "Use light theme",
        onClick: () => {},
        children: "Light",
      }),
    );
    const waxHtml = renderToString(() =>
      createComponent(WaxSealButton, {
        hint: "Save memory",
        type: "button",
        get children() {
          return <WaxSealLabel>Save memory</WaxSealLabel>;
        },
      }),
    );

    expect(kebabHtml).toContain('title="Memory actions"');
    expect(kebabHtml).toContain('aria-controls="memory-actions-test-menu"');
    expect(kebabHtml).not.toContain('role="tooltip"');
    expect(segmentedHtml).toContain('title="Use light theme"');
    expect(segmentedHtml).not.toContain('role="tooltip"');
    expect(waxHtml).toContain('title="Save memory"');
    expect(waxHtml).not.toContain('role="tooltip"');
  });

  it("requires callers to provide stable action-menu ids", () => {
    expect(kebabActionMenuSource).toContain("id: string");
    expect(kebabActionMenuSource).toContain("id={props.id}");
    expect(kebabActionMenuSource).not.toContain("props.id ??");
    expect(kebabActionMenuSource).not.toContain("replace(/[^a-z0-9]+/g");
  });

  it("wires hints into common shell, browse, composer, and reader action buttons", () => {
    expect(appShellSource).toContain('title="Theme settings"');
    expect(appShellSource).toContain('title="Local archive"');
    expect(appShellSource).toContain('hint="Add memory"');
    expect(appShellSource).toContain('hint="Use sun theme"');
    expect(memoryBrowseSource).toContain("MemoryReadStateTabs");
    expect(memoryBrowseSource).toContain("TaxonomyAddControl");
    expect(taxonomyAddControlSource).toContain("title={label()}");
    expect(addMemoryFormSource).toContain(
      'hint={isSubmitting() ? "Saving..." : props.submitLabel}',
    );
    expect(readerSource).toContain('title="Flashback selection"');
    expect(readerSource).toContain('title="Moment section"');
    expect(readerSource).toContain(
      'title={props.active ? "Remove moment" : "Save moment"}',
    );
    expect(readerSource).toContain('hint="Show current"');
    expect(readerSource).toContain('hint="Show all"');
  });
});
