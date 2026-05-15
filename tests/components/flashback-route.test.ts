import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const routeSource = readFileSync("src/routes/flashback/index.tsx", "utf8");
const browseSource = readFileSync(
  "src/components/flashback/FlashbackBrowse.tsx",
  "utf8",
);
const loaderSource = readFileSync(
  "src/components/flashback/flashbacks-loader.ts",
  "utf8",
);
const shellSource = readFileSync("src/components/shell/AppShell.tsx", "utf8");

describe("Flashback route", () => {
  it("registers /flashback as a first-class route in the shell", () => {
    expect(routeSource).toContain("FlashbackBrowse");
    expect(shellSource).toContain('href: "/flashback"');
    expect(shellSource).toContain('label: "Flashback"');
  });

  it("loads Flashbacks from SQLite metadata and links to memory section anchors", () => {
    expect(loaderSource).toContain("loadFlashbackBrowseRows");
    expect(browseSource).toContain("getFlashbackBrowseRows");
    expect(browseSource).toContain(
      "/memories/${props.flashback.memoryId}#${props.flashback.sectionAnchor}",
    );
    expect(browseSource).toContain("No Flashbacks yet");
    expect(browseSource).toContain("Saved reader sections will appear here.");
  });
});
