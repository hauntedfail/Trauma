import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import {
  confirmAndDeleteMemory,
  MemoryActionMenu,
} from "../../src/components/memories/MemoryActionMenu";

describe("memory action menu", () => {
  it("renders an accessible trigger and required menu items", () => {
    const html = renderToString(() =>
      createComponent(MemoryActionMenu, {
        memoryId: "memory-1",
        memoryTitle: "Memory One",
        initialOpen: true,
      }),
    );

    expect(html).toContain('aria-label="Memory actions for Memory One"');
    expect(html).toContain("Delete memory");
    expect(html).toContain("Add category");
  });

  it("asks for confirmation before deleting", async () => {
    const calls: string[] = [];
    const deleted = await confirmAndDeleteMemory({
      memoryId: "memory-1",
      confirm: (message) => {
        calls.push(message);
        return true;
      },
      onDelete: (memoryId) => {
        calls.push(memoryId);
      },
    });

    expect(deleted).toBe(true);
    expect(calls).toEqual([
      "Delete memory \"memory-1\"?",
      "memory-1",
    ]);
  });

  it("does not delete when confirmation is cancelled", async () => {
    const calls: string[] = [];
    const deleted = await confirmAndDeleteMemory({
      memoryId: "memory-1",
      confirm: () => false,
      onDelete: (memoryId) => {
        calls.push(memoryId);
      },
    });

    expect(deleted).toBe(false);
    expect(calls).toEqual([]);
  });
});
