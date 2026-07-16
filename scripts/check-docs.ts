import { readFile, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

interface DocumentationCheckResult {
  readonly documentCount: number;
  readonly indexedDocumentCount: number;
  readonly localLinkCount: number;
}

interface MarkdownLink {
  readonly destination: string;
  readonly line: number;
}

const INDEX_PATH = "docs/INDEX.md";
const ROOT_DOCUMENT_PATHS = [
  "AGENTS.md",
  "Backlog.md",
  "CLAUDE.md",
  "README.md",
] as const;
const REACHABILITY_EXCEPTIONS = new Set([
  "docs/references/coding-standards.md",
]);
const HISTORICAL_PREFIXES = [
  "docs/superpowers/specs/",
  "docs/workflows/archive/",
];
const COMPATIBILITY_ROUTE_OWNER = "docs/architecture/ui-and-routing.md";

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function lineNumberAt(source: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) {
      line += 1;
    }
  }
  return line;
}

function extractDestination(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("<")) {
    const closing = trimmed.indexOf(">");
    return closing === -1 ? trimmed.slice(1) : trimmed.slice(1, closing);
  }
  return trimmed.split(/\s+/, 1)[0] ?? "";
}

function markdownLinks(source: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  const pattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of source.matchAll(pattern)) {
    const destination = extractDestination(match[1] ?? "");
    if (destination.length === 0) {
      continue;
    }
    links.push({
      destination,
      line: lineNumberAt(source, match.index ?? 0),
    });
  }
  return links;
}

function isExternalDestination(destination: string): boolean {
  return (
    destination.startsWith("/") ||
    destination.startsWith("//") ||
    /^[a-z][a-z\d+.-]*:/i.test(destination)
  );
}

function decodeLinkPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function githubAnchor(rawHeading: string): string {
  return rawHeading
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

function markdownAnchors(source: string): Set<string> {
  const anchors = new Set<string>();
  const occurrences = new Map<string, number>();

  for (const line of source.split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) {
      continue;
    }
    const base = githubAnchor(match[2] ?? "");
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    anchors.add(occurrence === 0 ? base : `${base}-${occurrence}`);
  }

  return anchors;
}

function isHistoricalDocument(path: string): boolean {
  return HISTORICAL_PREFIXES.some((prefix) => path.startsWith(prefix));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function checkDocumentation(
  root = process.cwd(),
): Promise<DocumentationCheckResult> {
  const glob = new Bun.Glob("docs/**/*.md");
  const documentPaths: string[] = [];
  for await (const path of glob.scan({ cwd: root, onlyFiles: true })) {
    documentPaths.push(toPosix(path));
  }
  for (const path of ROOT_DOCUMENT_PATHS) {
    if (await pathExists(resolve(root, path))) {
      documentPaths.push(path);
    }
  }
  documentPaths.sort();

  if (!documentPaths.includes(INDEX_PATH)) {
    throw new Error(`Documentation check failed:\n- missing ${INDEX_PATH}`);
  }

  const documentSet = new Set(documentPaths);
  const sources = new Map<string, string>();
  const graph = new Map<string, Set<string>>();
  const failures: string[] = [];
  let localLinkCount = 0;

  for (const sourcePath of documentPaths) {
    const source = await readFile(resolve(root, sourcePath), "utf8");
    sources.set(sourcePath, source);
    graph.set(sourcePath, new Set());

    if (!isHistoricalDocument(sourcePath)) {
      const chronology =
        /\b(?:PR\s+#?\d+|pull request\s+#?\d+|commit\s+[0-9a-f]{7,40})\b/i.exec(
          source,
        );
      if (chronology) {
        failures.push(
          `${sourcePath}:${lineNumberAt(source, chronology.index)} contains review or commit chronology`,
        );
      }

      if (sourcePath !== COMPATIBILITY_ROUTE_OWNER) {
        const retiredRoute = /\/highlights\b|\/flashback(?!s)\b/i.exec(source);
        if (retiredRoute) {
          failures.push(
            `${sourcePath}:${lineNumberAt(source, retiredRoute.index)} contains retired active-domain route ${retiredRoute[0]}`,
          );
        }
      }
    }

    for (const link of markdownLinks(source)) {
      if (isExternalDestination(link.destination)) {
        continue;
      }
      localLinkCount += 1;

      const hashIndex = link.destination.indexOf("#");
      const rawTarget =
        hashIndex === -1
          ? link.destination
          : link.destination.slice(0, hashIndex);
      const rawFragment =
        hashIndex === -1 ? "" : link.destination.slice(hashIndex + 1);
      const queryIndex = rawTarget.indexOf("?");
      const targetPart = decodeLinkPart(
        queryIndex === -1 ? rawTarget : rawTarget.slice(0, queryIndex),
      );
      const fragment = decodeLinkPart(rawFragment).toLowerCase();
      const sourceAbsolutePath = resolve(root, sourcePath);
      const targetAbsolutePath = targetPart
        ? resolve(dirname(sourceAbsolutePath), targetPart)
        : sourceAbsolutePath;
      const targetPath = toPosix(relative(root, targetAbsolutePath));

      if (targetPath === ".." || targetPath.startsWith("../")) {
        failures.push(
          `${sourcePath}:${link.line} has local link outside the repository: ${link.destination}`,
        );
        continue;
      }

      if (!(await pathExists(targetAbsolutePath))) {
        failures.push(
          `${sourcePath}:${link.line} has broken local link: ${link.destination}`,
        );
        continue;
      }

      if (documentSet.has(targetPath)) {
        graph.get(sourcePath)?.add(targetPath);
      }

      if (fragment && targetPath.toLowerCase().endsWith(".md")) {
        const targetSource =
          sources.get(targetPath) ??
          (await readFile(targetAbsolutePath, "utf8"));
        if (!markdownAnchors(targetSource).has(fragment)) {
          failures.push(
            `${sourcePath}:${link.line} has missing anchor #${fragment} in ${targetPath}`,
          );
        }
      }
    }
  }

  const reachable = new Set<string>();
  const queue = [INDEX_PATH];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || reachable.has(current)) {
      continue;
    }
    reachable.add(current);
    for (const target of graph.get(current) ?? []) {
      if (!reachable.has(target)) {
        queue.push(target);
      }
    }
  }

  for (const documentPath of documentPaths) {
    if (
      documentPath.startsWith("docs/") &&
      !reachable.has(documentPath) &&
      !REACHABILITY_EXCEPTIONS.has(documentPath)
    ) {
      failures.push(`${documentPath} is not reachable from ${INDEX_PATH}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `Documentation check failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
    );
  }

  return {
    documentCount: documentPaths.length,
    indexedDocumentCount: reachable.size,
    localLinkCount,
  };
}

if (import.meta.main) {
  try {
    const result = await checkDocumentation();
    // eslint-disable-next-line no-console
    console.log(
      `Documentation check passed: ${result.documentCount} files, ${result.localLinkCount} local links, ${result.indexedDocumentCount} indexed docs.`,
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
