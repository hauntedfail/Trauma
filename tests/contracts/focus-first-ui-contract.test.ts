import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  FOCUS_FIRST_UI_AC_MANIFEST,
  FOCUS_FIRST_UI_DOC_PATH,
  type FocusFirstAcManifest,
} from "./focus-first-ui.contract";

interface ParsedAcceptanceCriterion {
  readonly number: number;
  readonly text: string;
}

interface ValidateAcContractInput {
  readonly docMarkdown: string;
  readonly manifest: FocusFirstAcManifest;
  readonly readSource: (filePath: string) => string | null;
}

const SECTION_10_HEADING_PATTERN = /^##\s+10\.\s+Acceptance Criteria\s*$/m;
const NEXT_H2_HEADING_PATTERN = /^##\s+/m;
const NUMBERED_ITEM_PATTERN = /^(\d+)\.\s+(.*)$/;
const CONTINUATION_LINE_PATTERN = /^\s+\S/;

function extractSection10Body(markdown: string): string | null {
  const headingMatch = SECTION_10_HEADING_PATTERN.exec(markdown);
  if (headingMatch === null) {
    return null;
  }

  const startIndex = headingMatch.index + headingMatch[0].length;
  const remainder = markdown.slice(startIndex);
  const nextHeadingMatch = NEXT_H2_HEADING_PATTERN.exec(remainder);
  return nextHeadingMatch === null
    ? remainder
    : remainder.slice(0, nextHeadingMatch.index);
}

function parseFocusFirstAcceptanceCriteria(
  markdown: string,
): ParsedAcceptanceCriterion[] | null {
  const sectionBody = extractSection10Body(markdown);
  if (sectionBody === null) {
    return null;
  }

  const criteria: ParsedAcceptanceCriterion[] = [];
  let activeNumber: number | null = null;
  let activeLines: string[] = [];

  const flushActive = (): void => {
    if (activeNumber === null) {
      return;
    }
    criteria.push({
      number: activeNumber,
      text: activeLines.join(" ").trim(),
    });
    activeNumber = null;
    activeLines = [];
  };

  for (const rawLine of sectionBody.split(/\r?\n/)) {
    const itemMatch = NUMBERED_ITEM_PATTERN.exec(rawLine);
    if (itemMatch !== null) {
      flushActive();
      activeNumber = Number.parseInt(itemMatch[1] ?? "", 10);
      activeLines = [(itemMatch[2] ?? "").trim()];
      continue;
    }

    if (activeNumber !== null && CONTINUATION_LINE_PATTERN.test(rawLine)) {
      activeLines.push(rawLine.trim());
      continue;
    }

    if (rawLine.trim().length === 0) {
      flushActive();
    }
  }

  flushActive();
  return criteria;
}

function hasExactStringLiteral(source: string, literal: string): boolean {
  const doubleQuoted = JSON.stringify(literal);
  if (source.includes(doubleQuoted)) {
    return true;
  }

  const singleQuoted = `'${literal
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")}'`;
  if (source.includes(singleQuoted)) {
    return true;
  }

  if (!literal.includes("${")) {
    const backtickQuoted = `\`${literal
      .replace(/\\/g, "\\\\")
      .replace(/`/g, "\\`")}\``;
    if (source.includes(backtickQuoted)) {
      return true;
    }
  }

  return false;
}

function validateFocusFirstAcContract(
  input: ValidateAcContractInput,
): string[] {
  const errors: string[] = [];
  const parsedCriteria = parseFocusFirstAcceptanceCriteria(input.docMarkdown);

  if (parsedCriteria === null) {
    return ["Section 10 ('## 10. Acceptance Criteria') was not found in document."];
  }

  if (parsedCriteria.length === 0) {
    return ["Section 10 contains no numbered acceptance criteria."];
  }

  const docAcNumbers = new Set<number>();
  for (const criterion of parsedCriteria) {
    if (docAcNumbers.has(criterion.number)) {
      errors.push(
        `AC ${criterion.number}: duplicate numbered entry in section 10.`,
      );
      continue;
    }
    docAcNumbers.add(criterion.number);
  }

  const sourceCache = new Map<string, string | null>();
  const readCachedSource = (filePath: string): string | null => {
    if (sourceCache.has(filePath)) {
      return sourceCache.get(filePath) ?? null;
    }
    const content = input.readSource(filePath);
    sourceCache.set(filePath, content);
    return content;
  };

  for (const acNumber of docAcNumbers) {
    const refs = input.manifest[acNumber];
    if (refs === undefined || refs.length === 0) {
      errors.push(
        `AC ${acNumber}: missing manifest entry in tests/contracts/focus-first-ui.contract.ts.`,
      );
    }
  }

  for (const rawKey of Object.keys(input.manifest)) {
    const acNumber = Number(rawKey);
    const refs = input.manifest[acNumber];

    if (!Number.isInteger(acNumber) || !docAcNumbers.has(acNumber)) {
      errors.push(
        `AC ${rawKey}: manifest references an unknown AC not present in section 10.`,
      );
    }

    if (refs === undefined || refs.length === 0) {
      continue;
    }

    for (const ref of refs) {
      const source = readCachedSource(ref.file);
      if (source === null) {
        errors.push(
          `AC ${rawKey}: referenced test file does not exist: ${ref.file}.`,
        );
        continue;
      }

      if (!hasExactStringLiteral(source, ref.title)) {
        errors.push(
          `AC ${rawKey}: referenced test title not found in ${ref.file}: ${JSON.stringify(ref.title)}.`,
        );
      }
    }
  }

  return errors;
}

describe("focus-first UI acceptance criteria contract manifest", () => {
  it("maps every numbered acceptance criterion in section 10 to an existing test file and title", () => {
    const repoRoot = process.cwd();
    const docMarkdown = readFileSync(
      resolve(repoRoot, FOCUS_FIRST_UI_DOC_PATH),
      "utf8",
    );
    const parsedCriteria = parseFocusFirstAcceptanceCriteria(docMarkdown);

    expect(parsedCriteria).not.toBeNull();
    const numbers = parsedCriteria?.map((item) => item.number) ?? [];
    expect(numbers.length).toBeGreaterThan(0);
    expect(numbers).toEqual(numbers.map((_, index) => index + 1));

    const errors = validateFocusFirstAcContract({
      docMarkdown,
      manifest: FOCUS_FIRST_UI_AC_MANIFEST,
      readSource: (filePath) => {
        const absolutePath = resolve(repoRoot, filePath);
        return existsSync(absolutePath)
          ? readFileSync(absolutePath, "utf8")
          : null;
      },
    });

    expect(errors).toEqual([]);
  });

  it("reports a failure naming the AC when the document has an unmapped extra AC", () => {
    const docMarkdown = [
      "## 10. Acceptance Criteria",
      "",
      "Intro paragraph.",
      "",
      "1. First criterion",
      "   wrapped continuation line.",
      "2. Second unmapped criterion.",
      "",
      "## 11. Delivery Phases",
    ].join("\n");

    const errors = validateFocusFirstAcContract({
      docMarkdown,
      manifest: {
        1: [{ file: "e2e/sample.spec.ts", title: "covers first (AC 1)" }],
      },
      readSource: (filePath) =>
        filePath === "e2e/sample.spec.ts"
          ? 'test("covers first (AC 1)", async () => {});'
          : null,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("AC 2");
  });

  it("reports a failure naming the AC when the manifest references an unknown AC", () => {
    const docMarkdown = [
      "## 10. Acceptance Criteria",
      "",
      "1. Only criterion.",
    ].join("\n");

    const errors = validateFocusFirstAcContract({
      docMarkdown,
      manifest: {
        1: [{ file: "e2e/sample.spec.ts", title: "covers first (AC 1)" }],
        99: [{ file: "e2e/sample.spec.ts", title: "covers ghost (AC 99)" }],
      },
      readSource: (filePath) =>
        filePath === "e2e/sample.spec.ts"
          ? [
              'test("covers first (AC 1)", async () => {});',
              'test("covers ghost (AC 99)", async () => {});',
            ].join("\n")
          : null,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("AC 99");
  });

  it("reports a failure naming the AC when a referenced test file does not exist", () => {
    const docMarkdown = [
      "## 10. Acceptance Criteria",
      "",
      "1. Criterion with missing file.",
    ].join("\n");

    const errors = validateFocusFirstAcContract({
      docMarkdown,
      manifest: {
        1: [
          {
            file: "e2e/does-not-exist.spec.ts",
            title: "missing file test (AC 1)",
          },
        ],
      },
      readSource: () => null,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("AC 1");
    expect(errors[0]).toContain("e2e/does-not-exist.spec.ts");
  });

  it("reports a failure naming the AC when a referenced test title is absent from the file", () => {
    const docMarkdown = [
      "## 10. Acceptance Criteria",
      "",
      "1. Criterion with missing title.",
    ].join("\n");

    const errors = validateFocusFirstAcContract({
      docMarkdown,
      manifest: {
        1: [
          {
            file: "e2e/sample.spec.ts",
            title: "absent title that was renamed (AC 1)",
          },
        ],
      },
      readSource: (filePath) =>
        filePath === "e2e/sample.spec.ts"
          ? 'test("some other test (AC 1)", async () => {});'
          : null,
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("AC 1");
    expect(errors[0]).toContain("absent title that was renamed (AC 1)");
  });
});
