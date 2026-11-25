import { describe, expect, it } from "vitest";

import { buildPassageGroundedAskPrompt } from "../../../src/server/agent-api/ask-prompt";
import { PSYCHIATRIST_MAX_USER_MESSAGE_CHARS } from "../../../src/server/psychiatrist/message-route";

const SAMPLE_MARKDOWN = [
  "# Focus-First Reading",
  "",
  "Intro paragraph about calm reading surfaces.",
  "",
  "## Working Memory",
  "",
  "Split-attention effects increase extraneous cognitive load when controls live far from text.",
  "",
  "## In-Situ Margin Notes",
  "",
  "Deictic triggers let readers simplify or explain a passage without opening a chat sidebar.",
].join("\n");

const SAMPLE_TOC = [
  { id: "focus-first-reading", level: 1, path: "1", text: "Focus-First Reading" },
  { id: "working-memory", level: 2, path: "1.1", text: "Working Memory" },
  { id: "in-situ-margin-notes", level: 2, path: "1.2", text: "In-Situ Margin Notes" },
];

describe("buildPassageGroundedAskPrompt", () => {
  it("builds a simplify prompt grounded in selectedText and resolves sectionTitle from TOC", () => {
    const result = buildPassageGroundedAskPrompt({
      action: "simplify",
      memoryId: "mem-1",
      memoryTitle: "Focus-First Reading",
      domain: "example.com",
      variantKind: "source",
      selectedText: "Split-attention effects increase extraneous cognitive load.",
      sectionAnchor: "working-memory",
      markdown: SAMPLE_MARKDOWN,
      toc: SAMPLE_TOC,
    });

    expect(result.prompt).toContain("Simplify the referenced passage");
    expect(result.prompt).toContain("Article: Focus-First Reading (example.com)");
    expect(result.prompt).toContain("Section: Working Memory (#working-memory)");
    expect(result.prompt).toContain("Selected passage:");
    expect(result.prompt).toContain(
      "Split-attention effects increase extraneous cognitive load.",
    );
    expect(result.prompt).not.toContain("Section excerpt:");
    expect(result.groundedContext).toEqual({
      action: "simplify",
      memoryId: "mem-1",
      memoryTitle: "Focus-First Reading",
      domain: "example.com",
      variantKind: "source",
      langCode: null,
      sectionAnchor: "working-memory",
      sectionTitle: "Working Memory",
      selectedText: "Split-attention effects increase extraneous cognitive load.",
      prompt: null,
    });
  });

  it("extracts a section excerpt when sectionAnchor is provided without selectedText", () => {
    const result = buildPassageGroundedAskPrompt({
      action: "explain",
      memoryId: "mem-1",
      memoryTitle: "Focus-First Reading",
      domain: "example.com",
      variantKind: "translation",
      langCode: "ja-JP",
      sectionAnchor: "in-situ-margin-notes",
      markdown: SAMPLE_MARKDOWN,
      toc: SAMPLE_TOC,
    });

    expect(result.prompt).toContain("Explain the referenced passage");
    expect(result.prompt).toContain("Section: In-Situ Margin Notes (#in-situ-margin-notes)");
    expect(result.prompt).toContain("Section excerpt:");
    expect(result.prompt).toContain("Deictic triggers let readers simplify");
    expect(result.groundedContext.variantKind).toBe("translation");
    expect(result.groundedContext.langCode).toBe("ja-JP");
    expect(result.groundedContext.sectionTitle).toBe("In-Situ Margin Notes");
  });

  it("prefers explicit sectionTitle over TOC heading and includes user question for ask action", () => {
    const result = buildPassageGroundedAskPrompt({
      action: "ask",
      memoryId: "mem-1",
      memoryTitle: "Focus-First Reading",
      domain: "example.com",
      variantKind: "source",
      sectionAnchor: "working-memory",
      sectionTitle: "Custom Heading Label",
      selectedText: "extraneous cognitive load",
      prompt: "How does this relate to ADHD?",
      markdown: SAMPLE_MARKDOWN,
      toc: SAMPLE_TOC,
    });

    expect(result.prompt).toContain("Answer the reader's question");
    expect(result.prompt).toContain("Section: Custom Heading Label (#working-memory)");
    expect(result.prompt).toContain("Question: How does this relate to ADHD?");
    expect(result.groundedContext.sectionTitle).toBe("Custom Heading Label");
    expect(result.groundedContext.prompt).toBe("How does this relate to ADHD?");
  });

  it("never exceeds PSYCHIATRIST_MAX_USER_MESSAGE_CHARS", () => {
    const result = buildPassageGroundedAskPrompt({
      action: "ask",
      memoryId: "mem-1",
      memoryTitle: "Long Article",
      domain: "example.com",
      variantKind: "source",
      selectedText: "a".repeat(3_000),
      prompt: "b".repeat(2_000),
    });

    expect(result.prompt.length).toBeLessThanOrEqual(
      PSYCHIATRIST_MAX_USER_MESSAGE_CHARS,
    );
    expect(result.prompt.endsWith("…")).toBe(true);
  });
});
