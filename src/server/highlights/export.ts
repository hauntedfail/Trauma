import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ResolvedTraumaConfig } from "../config";

export const HIGHLIGHT_METADATA_EXPORT_FILENAME = "HIGHLIGHTS.json";

export interface HighlightMetadataExportRow {
  id: string;
  memoryId: string;
  text: string;
  prefix: string;
  suffix: string;
  startOffset: number;
  endOffset: number;
  contentHash: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function getHighlightMetadataExportPath(memoryId: string): string {
  return `memories/${memoryId}/${HIGHLIGHT_METADATA_EXPORT_FILENAME}`;
}

export async function writeHighlightMetadataExport(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  memoryId: string;
  highlights: readonly HighlightMetadataExportRow[];
}): Promise<string> {
  const relativePath = getHighlightMetadataExportPath(input.memoryId);
  const absolutePath = join(input.config.storePath, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(
    absolutePath,
    `${JSON.stringify(toExportPayload(input), null, 2)}\n`,
    "utf8",
  );
  return relativePath;
}

function toExportPayload(input: {
  memoryId: string;
  highlights: readonly HighlightMetadataExportRow[];
}) {
  return {
    version: 1,
    memoryId: input.memoryId,
    highlights: [...input.highlights]
      .toSorted((left, right) => {
        if (left.startOffset !== right.startOffset) {
          return left.startOffset - right.startOffset;
        }
        return left.id.localeCompare(right.id);
      })
      .map((highlight) => ({
        id: highlight.id,
        memoryId: highlight.memoryId,
        text: highlight.text,
        prefix: highlight.prefix,
        suffix: highlight.suffix,
        startOffset: highlight.startOffset,
        endOffset: highlight.endOffset,
        contentHash: highlight.contentHash,
        createdAt: highlight.createdAt.toISOString(),
        updatedAt: highlight.updatedAt.toISOString(),
      })),
  };
}
