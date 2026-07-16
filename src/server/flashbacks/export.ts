import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ResolvedTraumaConfig } from "../config";
import {
  sourceFlashbackVariant,
  type FlashbackVariant,
} from "./variant";
import { withMemoryArtifactMutation } from "../memories/mutation-reservation";

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

export function getFlashbackMetadataExportPath(
  input:
    | string
    | {
        memoryId: string;
        variant: FlashbackVariant;
      },
): string {
  const memoryId = typeof input === "string" ? input : input.memoryId;
  const variant = typeof input === "string"
    ? sourceFlashbackVariant
    : input.variant;
  if (variant.kind === "source") {
    return `memories/${memoryId}/${FLASHBACK_METADATA_EXPORT_FILENAME}`;
  }

  return `memories/${memoryId}/${variant.langCode}/${FLASHBACK_METADATA_EXPORT_FILENAME}`;
}

export function getSourceFlashbackMetadataExportPath(memoryId: string): string {
  return getFlashbackMetadataExportPath({
    memoryId,
    variant: sourceFlashbackVariant,
  });
}

export function getTranslatedFlashbackMetadataExportPath(input: {
  langCode: string;
  memoryId: string;
}): string {
  return `memories/${input.memoryId}/${input.langCode}/${FLASHBACK_METADATA_EXPORT_FILENAME}`;
}

export async function writeFlashbackMetadataExport(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  memoryId: string;
  variant?: FlashbackVariant;
  flashbacks: readonly FlashbackMetadataExportRow[];
}): Promise<string> {
  return withMemoryArtifactMutation(
    { memoryId: input.memoryId, storePath: input.config.storePath },
    async (reservation) => {
      reservation.assertWritable();
      return writeFlashbackMetadataExportReserved(input);
    },
  );
}

async function writeFlashbackMetadataExportReserved(input: {
  config: Pick<ResolvedTraumaConfig, "storePath">;
  memoryId: string;
  variant?: FlashbackVariant;
  flashbacks: readonly FlashbackMetadataExportRow[];
}): Promise<string> {
  const variant = input.variant ?? sourceFlashbackVariant;
  const relativePath = getFlashbackMetadataExportPath({
    memoryId: input.memoryId,
    variant,
  });
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
      `${JSON.stringify(toExportPayload({ ...input, variant }), null, 2)}\n`,
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
  variant: FlashbackVariant;
  flashbacks: readonly FlashbackMetadataExportRow[];
}) {
  const flashbacks = [...input.flashbacks]
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
    }));

  if (input.variant.kind === "source") {
    return {
      version: 1,
      memoryId: input.memoryId,
      flashbacks,
    };
  }

  return {
    version: 2,
    memoryId: input.memoryId,
    variant: {
      kind: input.variant.kind,
      langCode: input.variant.langCode,
      translationOutputHash: input.variant.outputHash,
    },
    flashbacks,
  };
}
