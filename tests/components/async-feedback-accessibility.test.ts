import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(path, "utf8");

describe("async action feedback accessibility", () => {
  it("announces action failures without requiring visual discovery", () => {
    const sources = [
      "src/components/memories/MemoryReadStatusControl.tsx",
      "src/components/memories/MemoryBrowse.tsx",
      "src/components/memories/MemoryActionMenu.tsx",
      "src/components/flashbacks/FlashbackActionMenu.tsx",
      "src/components/moments/MomentActionMenu.tsx",
    ].map(readSource);

    for (const source of sources) {
      expect(source).toContain('role="alert"');
    }
  });

  it("announces settings success messages politely", () => {
    const source = readSource("src/components/settings/SettingsPage.tsx");
    const successMessageStart = source.indexOf("<Show when={message()}>");
    const errorMessageStart = source.indexOf(
      "<Show when={error()}>",
      successMessageStart,
    );
    const successMessageSource = source.slice(
      successMessageStart,
      errorMessageStart,
    );

    expect(successMessageStart).toBeGreaterThan(-1);
    expect(successMessageSource).toContain('role="status"');
  });
});
