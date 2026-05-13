import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const serviceWorkerSource = readFileSync(
  "extensions/browser/src/service-worker.ts",
  "utf8",
);

describe("browser extension service worker", () => {
  it("injects the bundled content script by file", () => {
    expect(serviceWorkerSource).toContain('files: ["inject.bundle.js"]');
    expect(serviceWorkerSource).not.toContain("func: createCapturedTabSnapshot");
  });
});
