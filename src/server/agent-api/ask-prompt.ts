import { PSYCHIATRIST_MAX_USER_MESSAGE_CHARS } from "../psychiatrist/message-route";
import type { ReaderTocEntry } from "../reader/markdown-renderer";
import type { SupportedLanguageCode } from "../translation/languages";
import type { AgentAskAction, AgentAskGroundedContext } from "./types";

const MAX_SECTION_EXCERPT_CHARS = 800;

export interface BuildPassageGroundedAskPromptInput {
  action: AgentAskAction;
  memoryId: string;
  memoryTitle: string;
  domain: string;
  variantKind: "source" | "translation";
  langCode?: SupportedLanguageCode;
  selectedText?: string;
  sectionAnchor?: string;
  sectionTitle?: string;
  prompt?: string;
  markdown?: string;
  toc?: ReaderTocEntry[];
}

export interface PassageGroundedAskPromptResult {
  prompt: string;
  groundedContext: AgentAskGroundedContext;
}

export function buildPassageGroundedAskPrompt(
  input: BuildPassageGroundedAskPromptInput,
): PassageGroundedAskPromptResult {
  const selectedText = normalizeOptionalText(input.selectedText);
  const sectionAnchor = normalizeOptionalText(input.sectionAnchor);
  const explicitSectionTitle = normalizeOptionalText(input.sectionTitle);
  const userPrompt = normalizeOptionalText(input.prompt);

  const matchedToc =
    sectionAnchor !== null && input.toc !== undefined
      ? input.toc.find((entry) => entry.id === sectionAnchor)
      : undefined;
  const sectionTitle = explicitSectionTitle ?? matchedToc?.text ?? null;

  const sectionExcerpt =
    selectedText === null && sectionTitle !== null && input.markdown !== undefined
      ? extractSectionExcerpt(input.markdown, sectionTitle)
      : null;

  const lines: string[] = [
    actionInstruction(input.action),
    `Article: ${input.memoryTitle} (${input.domain})`,
  ];

  if (sectionTitle !== null && sectionAnchor !== null) {
    lines.push(`Section: ${sectionTitle} (#${sectionAnchor})`);
  } else if (sectionTitle !== null) {
    lines.push(`Section: ${sectionTitle}`);
  } else if (sectionAnchor !== null) {
    lines.push(`Section anchor: #${sectionAnchor}`);
  }

  if (selectedText !== null) {
    lines.push("Selected passage:", '"""', selectedText, '"""');
  } else if (sectionExcerpt !== null) {
    lines.push("Section excerpt:", '"""', sectionExcerpt, '"""');
  }

  if (userPrompt !== null) {
    lines.push(
      input.action === "ask"
        ? `Question: ${userPrompt}`
        : `Additional focus: ${userPrompt}`,
    );
  }

  const prompt = truncateToMaxChars(
    lines.join("\n"),
    PSYCHIATRIST_MAX_USER_MESSAGE_CHARS,
  );

  return {
    prompt,
    groundedContext: {
      action: input.action,
      memoryId: input.memoryId,
      memoryTitle: input.memoryTitle,
      domain: input.domain,
      variantKind: input.variantKind,
      langCode: input.langCode ?? null,
      sectionAnchor,
      sectionTitle,
      selectedText,
      prompt: userPrompt,
    },
  };
}

function actionInstruction(action: AgentAskAction): string {
  switch (action) {
    case "simplify":
      return "Simplify the referenced passage into clear, plain language while preserving its core meaning.";
    case "explain":
      return "Explain the referenced passage in the context of this article, clarifying key concepts and implications.";
    case "ask":
      return "Answer the reader's question grounded in the referenced passage and article.";
  }
}

function normalizeOptionalText(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractSectionExcerpt(
  markdown: string,
  sectionTitle: string,
): string | null {
  const normalizedTarget = normalizeHeadingText(sectionTitle);
  if (normalizedTarget.length === 0) {
    return null;
  }

  const lines = markdown.split(/\r?\n/u);
  let collecting = false;
  const collected: string[] = [];

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line);
    if (headingMatch !== null) {
      if (collecting) {
        break;
      }
      const headingText = normalizeHeadingText(headingMatch[2] ?? "");
      if (headingText === normalizedTarget) {
        collecting = true;
      }
      continue;
    }

    if (collecting) {
      collected.push(line);
    }
  }

  const excerpt = collected.join("\n").trim();
  if (excerpt.length === 0) {
    return null;
  }

  return truncateToMaxChars(excerpt, MAX_SECTION_EXCERPT_CHARS);
}

function normalizeHeadingText(text: string): string {
  return text
    .replace(/[`*_~]/gu, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .trim()
    .toLowerCase();
}

function truncateToMaxChars(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  if (maxChars <= 1) {
    return value.slice(0, maxChars);
  }
  return `${value.slice(0, maxChars - 1).trimEnd()}…`;
}
