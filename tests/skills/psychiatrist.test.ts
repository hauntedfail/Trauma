import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("psychiatrist skill policy", () => {
  const skill = readFileSync(".agents/skills/psychiatrist/SKILL.md", "utf8");

  it("captures memory-scoped assistant policy without granting runtime tools", () => {
    expect(skill).toContain("memory-scoped");
    expect(skill).toContain("pair model");
    expect(skill).toContain("process/status updates");
    expect(skill).toContain("hidden chain-of-thought");
    expect(skill).toContain("untrusted data");
    expect(skill).toContain("does not provide enough information");
    expect(skill).toContain("explicitly requests Stop");
    expect(skill).toContain("Regenerate");
    expect(skill).toContain("Do not present as a medical professional");
    expect(skill).toContain("Do not modify memories");
    expect(skill).toContain("Do not access the filesystem");
    expect(skill).toContain("execute shell commands");
    expect(skill).toContain("unless the current turn explicitly says the user approved web-source access");
    expect(skill).toContain("cite retrieved sources");
  });
});
