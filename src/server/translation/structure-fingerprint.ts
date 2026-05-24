import type { Parent } from "unist";
import { visitParents } from "unist-util-visit-parents";

import { parseTranslationMarkdownAst } from "./markdown-parser";
import { TranslationOutputValidationError } from "./errors";

export interface MarkdownStructureFingerprint {
  entries: MarkdownStructureFingerprintEntry[];
}

export interface MarkdownStructureFingerprintEntry {
  kind:
    | "block"
    | "code"
    | "inline_code"
    | "math"
    | "inline_math"
    | "html"
    | "link_destination"
    | "image_destination"
    | "definition"
    | "link_reference"
    | "image_reference"
    | "table"
    | "footnote_definition"
    | "footnote_reference";
  value: string;
}

interface FingerprintNode extends Parent {
  identifier?: string;
  lang?: string;
  meta?: string;
  ordered?: boolean;
  depth?: number;
  referenceType?: string;
  title?: string | null;
  url?: string;
  value?: string;
}

export function createMarkdownStructureFingerprint(
  markdown: string,
): MarkdownStructureFingerprint {
  const parsed = parseTranslationMarkdownAst(markdown);
  const entries: MarkdownStructureFingerprintEntry[] = [];

  visitParents(parsed.tree, (node) => {
    const current = node as FingerprintNode;
    if (isStructuralNode(current)) {
      entries.push({
        kind: "block",
        value: readStructuralNodeValue(current),
      });
    }
    if (current.type === "code") {
      entries.push({
        kind: "code",
        value: JSON.stringify({
          lang: current.lang ?? null,
          meta: current.meta ?? null,
          value: current.value ?? "",
        }),
      });
    } else if (current.type === "inlineCode") {
      entries.push({ kind: "inline_code", value: current.value ?? "" });
    } else if (current.type === "math") {
      entries.push({ kind: "math", value: current.value ?? "" });
    } else if (current.type === "inlineMath") {
      entries.push({ kind: "inline_math", value: current.value ?? "" });
    } else if (current.type === "html") {
      entries.push({ kind: "html", value: current.value ?? "" });
    } else if (current.type === "link" && typeof current.url === "string") {
      entries.push({
        kind: "link_destination",
        value: JSON.stringify({ title: current.title ?? null, url: current.url }),
      });
    } else if (current.type === "image" && typeof current.url === "string") {
      entries.push({
        kind: "image_destination",
        value: JSON.stringify({ title: current.title ?? null, url: current.url }),
      });
    } else if (
      current.type === "definition" &&
      typeof current.identifier === "string"
    ) {
      entries.push({
        kind: "definition",
        value: JSON.stringify({
          identifier: current.identifier,
          title: current.title ?? null,
          url: current.url ?? "",
        }),
      });
    } else if (
      current.type === "linkReference" &&
      typeof current.identifier === "string"
    ) {
      entries.push({
        kind: "link_reference",
        value: JSON.stringify({
          identifier: current.identifier,
          referenceType: current.referenceType ?? null,
        }),
      });
    } else if (
      current.type === "imageReference" &&
      typeof current.identifier === "string"
    ) {
      entries.push({
        kind: "image_reference",
        value: JSON.stringify({
          identifier: current.identifier,
          referenceType: current.referenceType ?? null,
        }),
      });
    } else if (current.type === "table") {
      entries.push({
        kind: "table",
        value: readTableShape(current),
      });
    } else if (
      current.type === "footnoteDefinition" &&
      typeof current.identifier === "string"
    ) {
      entries.push({
        kind: "footnote_definition",
        value: current.identifier,
      });
    } else if (
      current.type === "footnoteReference" &&
      typeof current.identifier === "string"
    ) {
      entries.push({
        kind: "footnote_reference",
        value: current.identifier,
      });
    }
  });

  return { entries };
}

export function assertMarkdownStructurePreserved(input: {
  source: string;
  translated: string;
}): void {
  const source = createMarkdownStructureFingerprint(input.source);
  const translated = createMarkdownStructureFingerprint(input.translated);
  const max = Math.max(source.entries.length, translated.entries.length);

  for (let index = 0; index < max; index += 1) {
    const sourceEntry = source.entries[index];
    const translatedEntry = translated.entries[index];
    if (sourceEntry === undefined || translatedEntry === undefined) {
      throw new TranslationOutputValidationError(
        "Codex output changed Markdown structure entry count.",
      );
    }
    if (sourceEntry.kind !== translatedEntry.kind) {
      throw new TranslationOutputValidationError(
        `Codex output changed ${formatFingerprintKind(sourceEntry.kind)} structure.`,
      );
    }
    if (sourceEntry.value !== translatedEntry.value) {
      throw new TranslationOutputValidationError(
        `Codex output changed ${formatFingerprintKind(sourceEntry.kind)}.`,
      );
    }
  }
}

function readTableShape(node: FingerprintNode): string {
  const rows = (node.children ?? []) as Parent[];
  return rows.map((row) => (row.children ?? []).length).join(",");
}

function isStructuralNode(node: FingerprintNode): boolean {
  return node.type === "heading" ||
    node.type === "paragraph" ||
    node.type === "blockquote" ||
    node.type === "list" ||
    node.type === "listItem" ||
    node.type === "table" ||
    node.type === "tableRow" ||
    node.type === "tableCell" ||
    node.type === "code" ||
    node.type === "math" ||
    node.type === "html" ||
    node.type === "thematicBreak" ||
    node.type === "footnoteDefinition" ||
    node.type === "definition";
}

function readStructuralNodeValue(node: FingerprintNode): string {
  if (node.type === "heading") {
    return `heading:${node.depth ?? ""}`;
  }
  if (node.type === "list") {
    return `list:${node.ordered === true ? "ordered" : "unordered"}`;
  }
  return node.type;
}

function formatFingerprintKind(
  kind: MarkdownStructureFingerprintEntry["kind"],
): string {
  return kind.replaceAll("_", " ");
}
