import { createComponent, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import {
  deleteFlashbackBySelection,
  FlashbackActionMenu,
  type FlashbackActionMenuItem,
} from "../../src/components/flashbacks/FlashbackActionMenu";

const flashback = {
  id: "flashback-1",
  memoryId: "memory-1",
  text: "selected text",
  prefix: "before ",
  suffix: " after",
  startOffset: 7,
  endOffset: 20,
} satisfies FlashbackActionMenuItem;

describe("Flashback action menu", () => {
  it("renders a shared danger delete menu item", () => {
    const html = renderToString(() =>
      createComponent(FlashbackActionMenu, {
        flashback,
        initialOpen: true,
      }),
    );

    expect(html).toContain('aria-label="Flashback actions for selected text"');
    expect(html).toContain('id="flashback-flashback-1-actions-menu"');
    expect(html).toContain("Delete flashback");
    expect(html).toContain("text-trauma-danger");
    expect(html).toContain("M4 7h16");
  });

  it("deletes flashbacks through the existing toggle endpoint", async () => {
    const requests: Request[] = [];

    await deleteFlashbackBySelection({
      flashback,
      fetch: async (input, init) => {
        requests.push(new Request(new URL(String(input), "http://localhost"), init));
        return new Response(JSON.stringify({ result: { flashbacks: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    expect(requests.map((request) => [request.url, request.method])).toEqual([
      ["http://localhost/api/flashbacks", "POST"],
    ]);
    expect(await requests[0]?.json()).toEqual({
      memoryId: "memory-1",
      operation: "unflashback",
      selection: {
        text: "selected text",
        prefix: "before ",
        suffix: " after",
        startOffset: 7,
        endOffset: 20,
      },
    });
  });

  it("keeps backup failsafe revalidation wired for failed deletes", async () => {
    const source = await import("node:fs").then(({ readFileSync }) =>
      readFileSync("src/components/flashbacks/FlashbackActionMenu.tsx", "utf8"),
    );

    await expect(
      deleteFlashbackBySelection({
        flashback,
        fetch: async () =>
          new Response(
            JSON.stringify({
              error: "Backup location changed",
              backupFailsafe: { kind: "backup_path_drift" },
            }),
            {
              status: 409,
              headers: { "content-type": "application/json" },
            },
          ),
      }),
    ).rejects.toThrow("Flashback failed");
    expect(source).toContain("revalidateBackupFailsafeAlert");
    expect(source).toContain("shouldRevalidateBackupFailsafeAfterFlashbackFailure");
  });
});
