import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("reader-translate skill policy", () => {
  const skill = readFileSync(".agents/skills/reader-translate/SKILL.md", "utf8");

  it("captures Brilliant translation policy without granting runtime write authority", () => {
    expect(skill).toContain("untrusted article data");
    expect(skill).toContain("Preserve Markdown");
    expect(skill).toContain("Preserve HTML tags and attributes");
    expect(skill).toContain("Preserve LaTeX");
    expect(skill).toContain("citations");
    expect(skill).toContain("code fences");
    expect(skill).toContain("Never summarize");
    expect(skill).toContain("schema-compliant output");
    expect(skill).toContain("Do not write canonical `CONTENT.md` files");
    expect(skill).toContain("Do not access the filesystem");
  });
});
