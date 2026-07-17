import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const routeSource = readFileSync("src/routes/moments/index.tsx", "utf8");
const browseSource = readFileSync(
  "src/components/moments/MomentBrowse.tsx",
  "utf8",
);
const loaderSource = readFileSync(
  "src/components/moments/moments-loader.ts",
  "utf8",
);
const shellSource = readFileSync("src/components/shell/AppShell.tsx", "utf8");

describe("Moment route", () => {
  it("registers /moments as a first-class route in the shell", () => {
    expect(routeSource).toContain("MomentBrowse");
    expect(shellSource).toContain('href: "/moments"');
    expect(shellSource).toContain('label: "Moments"');
  });

  it("loads Moments from SQLite metadata and links to memory section anchors", () => {
    expect(loaderSource).toContain("loadMomentBrowsePage");
    expect(browseSource).toContain("getMomentBrowsePage");
    expect(browseSource).toContain("useLocation");
    expect(browseSource).toContain("nextCursor");
    expect(browseSource).toContain('href="/moments"');
    expect(browseSource).toContain("MomentActionMenu");
    expect(browseSource).toContain("deleteMomentById");
    expect(browseSource).toContain("revalidateMomentBrowseRows");
    expect(browseSource).toContain("revalidateReaderMemory(memoryId)");
    expect(browseSource).toContain("anchorId: props.moment.targetAnchor");
    expect(browseSource).toContain('props.moment.targetStatus === "stale"');
    expect(browseSource).toContain("Section moved");
    expect(browseSource).toContain("buildMemoryAnchorHref");
    expect(browseSource).toContain("No Moments yet");
    expect(browseSource).toContain("Saved reader sections will appear here.");
    expect(browseSource).not.toContain("Saved sections");
  });
});
