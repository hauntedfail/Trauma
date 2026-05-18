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
const readerSource = readFileSync("src/components/reader/MemoryReader.tsx", "utf8");

describe("button hover hints", () => {
  it("defines animated hover and focus-visible hints from a shared data attribute", () => {
    expect(tailwindSource).toContain("[data-trauma-hint]");
    expect(tailwindSource).toContain(".trauma-button-hint");
    expect(tailwindSource).toContain('content: attr(data-trauma-hint-label)');
    expect(tailwindSource).toContain("display: none");
    expect(tailwindSource).toContain("display: block");
    expect(tailwindSource).toContain("animation: trauma-button-hint-in");
    expect(tailwindSource).toContain("@keyframes trauma-button-hint-in");
    expect(tailwindSource).toContain("[data-trauma-hint]:focus-visible");
    expect(tailwindSource).toContain("> .trauma-button-hint");
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

    expect(readHtml).toContain('data-trauma-hint="Mark as unread"');
    expect(unreadHtml).toContain('data-trauma-hint="Mark as read"');
  });

  it("lets shared button primitives expose hints without local tooltip markup", () => {
    const kebabHtml = renderToString(() =>
      createComponent(KebabActionMenu, {
        label: "Memory actions",
        children: () => null,
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

    expect(kebabHtml).toContain('data-trauma-hint="Memory actions"');
    expect(kebabHtml).toContain('data-trauma-hint-label="Memory actions"');
    expect(kebabHtml).toContain("trauma-button-hint");
    expect(segmentedHtml).toContain('data-trauma-hint="Use light theme"');
    expect(waxHtml).toContain('data-trauma-hint="Save memory"');
  });

  it("wires hints into common shell, browse, composer, and reader action buttons", () => {
    expect(appShellSource).toContain('data-trauma-hint="Theme settings"');
    expect(appShellSource).toContain('data-trauma-hint="Local archive"');
    expect(appShellSource).toContain('hint="Add memory"');
    expect(appShellSource).toContain('hint="Use sun theme"');
    expect(memoryBrowseSource).toContain('hint="List view"');
    expect(memoryBrowseSource).toContain('hint="Grid view"');
    expect(memoryBrowseSource).toContain('data-trauma-hint="Add tag"');
    expect(addMemoryFormSource).toContain(
      'hint={isSubmitting() ? "Saving..." : props.submitLabel}',
    );
    expect(readerSource).toContain('data-trauma-hint="Flashback selection"');
    expect(readerSource).toContain('data-trauma-hint="Moment section"');
    expect(readerSource).toContain(
      'data-trauma-hint={props.active ? "Remove moment" : "Save moment"}',
    );
    expect(readerSource).toContain('hint="Show current"');
    expect(readerSource).toContain('hint="Show all"');
  });
});
