import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ResolvedTraumaConfig } from "../config";

export const FLASHBACK_METADATA_EXPORT_FILENAME = "FLASHBACKS.json";

export interface FlashbackMetadataExportRow {
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

export function getFlashbackMetadataExportPath(memoryId: string): string {
  return `memories/${memoryId}/${FLASHBACK_METADATA_EXPORT_FILENAME}`;
}

export async function writeFlashbackMetadataExport(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  memoryId: string;
  flashbacks: readonly FlashbackMetadataExportRow[];
}): Promise<string> {
  const relativePath = getFlashbackMetadataExportPath(input.memoryId);
  const absolutePath = join(input.config.storePath, relativePath);
  const temporaryPath = join(
    dirname(absolutePath),
    `.${FLASHBACK_METADATA_EXPORT_FILENAME}.${randomUUID()}.tmp`,
  );
  let temporaryFileMoved = false;
  await mkdir(dirname(absolutePath), { recursive: true });
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(toExportPayload(input), null, 2)}\n`,
      "utf8",
    );
    await rename(temporaryPath, absolutePath);
    temporaryFileMoved = true;
  } finally {
    if (!temporaryFileMoved) {
      await rm(temporaryPath, { force: true });
    }
  }
  return relativePath;
}

function toExportPayload(input: {
  memoryId: string;
  flashbacks: readonly FlashbackMetadataExportRow[];
}) {
  return {
    version: 1,
    memoryId: input.memoryId,
    flashbacks: [...input.flashbacks]
      .toSorted((left, right) => {
        if (left.startOffset !== right.startOffset) {
          return left.startOffset - right.startOffset;
        }
        return left.id.localeCompare(right.id);
      })
      .map((flashback) => ({
        id: flashback.id,
        memoryId: flashback.memoryId,
        text: flashback.text,
        prefix: flashback.prefix,
        suffix: flashback.suffix,
        startOffset: flashback.startOffset,
        endOffset: flashback.endOffset,
        contentHash: flashback.contentHash,
        createdAt: flashback.createdAt.toISOString(),
        updatedAt: flashback.updatedAt.toISOString(),
      })),
  };
}
