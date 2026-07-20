import type { ReaderMomentItem } from "../../server/reader/page-data";
import type { ReaderTocEntry } from "../../server/reader/markdown-renderer";
import type { ReaderMomentSection } from "./moment-requests";

interface ReaderMomentPathTargets {
  exactByAnchor: Map<string, ReaderTocEntry>;
  uniqueTarget: ReaderTocEntry | undefined;
}

function indexReaderMomentTargets(
  toc: readonly ReaderTocEntry[],
): Map<string, ReaderMomentPathTargets> {
  const targetsByPath = new Map<string, ReaderMomentPathTargets>();

  for (const entry of toc) {
    const path = entry.path;
    const anchor = entry.id;
    const existing = targetsByPath.get(path);
    if (existing === undefined) {
      targetsByPath.set(path, {
        exactByAnchor: new Map([[anchor, entry]]),
        uniqueTarget: entry,
      });
      continue;
    }

    if (!existing.exactByAnchor.has(anchor)) {
      existing.exactByAnchor.set(anchor, entry);
    }
    existing.uniqueTarget = undefined;
  }

  return targetsByPath;
}

function resolveIndexedReaderMomentTarget(
  moment: ReaderMomentItem,
  targetsByPath: ReadonlyMap<string, ReaderMomentPathTargets>,
): ReaderTocEntry | undefined {
  const pathTargets = targetsByPath.get(moment.sectionPath);
  return pathTargets?.exactByAnchor.get(moment.sectionAnchor) ??
    pathTargets?.uniqueTarget;
}

export function resolveReaderMomentTarget(
  moment: ReaderMomentItem,
  toc: readonly ReaderTocEntry[],
): ReaderTocEntry | undefined {
  return resolveIndexedReaderMomentTarget(moment, indexReaderMomentTargets(toc));
}

export function collectResolvedReaderMomentTargetIds(
  moments: readonly ReaderMomentItem[],
  toc: readonly ReaderTocEntry[],
): ReadonlySet<string> {
  const targetsByPath = indexReaderMomentTargets(toc);
  const targetIds = new Set<string>();

  for (const moment of moments) {
    const target = resolveIndexedReaderMomentTarget(moment, targetsByPath);
    if (target !== undefined) {
      targetIds.add(target.id);
    }
  }

  return targetIds;
}

export function findReaderMomentForSection(
  moments: readonly ReaderMomentItem[],
  toc: readonly ReaderTocEntry[],
  section: ReaderMomentSection,
): ReaderMomentItem | undefined {
  const targetsByPath = indexReaderMomentTargets(toc);
  return moments.find((moment) =>
    resolveIndexedReaderMomentTarget(moment, targetsByPath)?.id === section.id
  );
}
