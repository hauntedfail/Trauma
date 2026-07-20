import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { evaluateReleaseTag } from "../../scripts/release-contract";

const releaseWorkflow = readFileSync(".github/workflows/release.yml", "utf8");
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const playwrightConfig = readFileSync("playwright.config.ts", "utf8");

describe("release tag contract", () => {
  it.each(["0.3.0", "v0.3.0"])(
    "accepts %s only when it matches package.json",
    (tagName) => {
      expect(evaluateReleaseTag(tagName, "0.3.0")).toEqual({
        kind: "release",
        tagName,
        version: "0.3.0",
      });
    },
  );

  it("rejects a well-formed tag for a different package version", () => {
    expect(evaluateReleaseTag("v0.4.0", "0.3.0")).toEqual({
      kind: "error",
      packageVersion: "0.3.0",
      reason: "version-mismatch",
      tagName: "v0.4.0",
      tagVersion: "0.4.0",
    });
  });

  it("skips tag names outside the supported three-part numeric format", () => {
    expect(evaluateReleaseTag("v0.3.0-rc.1", "0.3.0")).toEqual({
      kind: "skip",
      reason: "invalid-tag-format",
      tagName: "v0.3.0-rc.1",
    });
  });

  it("fails closed when package.json has an unsupported version", () => {
    expect(evaluateReleaseTag("v0.3.0", "next")).toEqual({
      kind: "error",
      packageVersion: "next",
      reason: "invalid-package-version",
      tagName: "v0.3.0",
    });
  });
});

describe("release workflow contract", () => {
  it("validates package.json from the exact tagged commit", () => {
    expect(releaseWorkflow).toContain("bun run scripts/validate-release.ts");
    expect(releaseWorkflow.match(/ref: \$\{\{ github\.sha \}\}/g)).toHaveLength(3);
  });

  it("selects checked-out changelog notes without treating API failures as absence", () => {
    expect(releaseWorkflow).toContain(
      'RELEASE_NOTES_PATH="changelog/v${RELEASE_VERSION}.md"',
    );
    expect(releaseWorkflow).toContain('[[ -f "$RELEASE_NOTES_PATH" ]]');
    expect(releaseWorkflow).toContain(
      '[[ ! -e "$RELEASE_NOTES_PATH" && ! -L "$RELEASE_NOTES_PATH" ]]',
    );
    expect(releaseWorkflow).toContain("Invalid release notes path");
    expect(releaseWorkflow).toContain('--notes-file "$RELEASE_NOTES_PATH"');
    expect(releaseWorkflow).not.toContain("RELEASE_NOTES_API");
    expect(releaseWorkflow).not.toMatch(/gh api .*changelog/);
  });
});

describe("Playwright failure evidence contract", () => {
  it("retains a trace from the first failed E2E attempt", () => {
    expect(playwrightConfig).toContain('trace: "retain-on-failure"');
    expect(playwrightConfig).not.toContain('trace: "on-first-retry"');
    expect(playwrightConfig).toContain('["html", { open: "never" }]');
  });

  it.each([
    ["CI", ciWorkflow],
    ["Release", releaseWorkflow],
  ])(
    "uploads bounded %s failure artifacts with a pinned action",
    (_name, workflow) => {
      expect(workflow).toContain(
        "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2",
      );
      expect(workflow).toContain("if: failure()");
      expect(workflow).toContain("playwright-report/");
      expect(workflow).toContain("test-results/");
      expect(workflow).toContain("retention-days: 7");
    },
  );
});
