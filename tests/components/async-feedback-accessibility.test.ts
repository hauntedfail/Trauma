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

  it("announces terminal reader and Psychiatrist failures assertively", () => {
    const readerSource = readSource("src/components/reader/MemoryReader.tsx");
    const psychiatristSource = readSource(
      "src/components/reader/PsychiatristDock.tsx",
    );

    expect(readerSource).toContain(
      'role={progress().status === "failed" ? "alert" : "status"}',
    );
    expect(readerSource).toContain(
      'aria-live={progress().status === "failed" ? "assertive" : "polite"}',
    );
    expect(readerSource).toContain(
      '<Show when={errorMessage()}>',
    );
    expect(readerSource).toContain('role="alert"');
    expect(psychiatristSource).toContain(
      '<Show when={errorMessage() === ""}>',
    );
    expect(psychiatristSource).toContain('role="alert"');
  });

  it("announces Codex catalog failures assertively", () => {
    const source = readSource("src/components/settings/SettingsPage.tsx");
    const catalogErrorStart = source.indexOf(
      "export function CodexCatalogFeedback",
    );
    const catalogErrorSource = source.slice(
      catalogErrorStart,
      source.indexOf(
        "export function captureCodexCatalogRetryFocusIntent",
        catalogErrorStart,
      ),
    );

    expect(catalogErrorStart).toBeGreaterThan(-1);
    expect(catalogErrorSource).toContain('role="alert"');
    expect(catalogErrorSource).toContain('type="button"');
    expect(catalogErrorSource).toContain("Retrying...");
  });
});
