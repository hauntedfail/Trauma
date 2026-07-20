import { access } from "node:fs/promises";
import { resolve } from "node:path";

import type { ResolvedTraumaConfig } from "../config";
import type { FlashbackRepository } from "../db";
import { withFlashbackVariantMutationLock } from "./coordination";
import {
  getFlashbackMetadataExportPath,
  writeFlashbackMetadataExport,
  type FlashbackMetadataExportFileSystem,
} from "./export";
import type { FlashbackVariant } from "./variant";

export async function reconcileFlashbackMetadataExport(input: {
  beforeWrite?: () => Promise<void> | void;
  config: Pick<ResolvedTraumaConfig, "storePath">;
  fileSystem?: FlashbackMetadataExportFileSystem;
  flashbacks: Pick<FlashbackRepository, "listForMemoryVariant">;
  memoryId: string;
  resolveAuthoritativeVariant?: () => Promise<FlashbackVariant | undefined>;
  variant: FlashbackVariant;
  writeEmptyIfMissing?: boolean;
}): Promise<string | undefined> {
  return withFlashbackVariantMutationLock(
    {
      memoryId: input.memoryId,
      storePath: input.config.storePath,
      variant: input.variant,
    },
    async () => {
      const authoritativeVariant = input.resolveAuthoritativeVariant === undefined
        ? input.variant
        : await input.resolveAuthoritativeVariant();
      if (authoritativeVariant === undefined) {
        return undefined;
      }
      const rows = await input.flashbacks.listForMemoryVariant({
        memoryId: input.memoryId,
        variant: authoritativeVariant,
      });
      const relativePath = getFlashbackMetadataExportPath({
        memoryId: input.memoryId,
        variant: authoritativeVariant,
      });
      if (
        rows.length === 0 &&
        input.writeEmptyIfMissing !== true &&
        !(await pathExists(resolve(input.config.storePath, relativePath)))
      ) {
        return undefined;
      }

      await input.beforeWrite?.();
      return writeFlashbackMetadataExport({
        config: input.config,
        fileSystem: input.fileSystem,
        flashbacks: rows,
        memoryId: input.memoryId,
        variant: authoritativeVariant,
      });
    },
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
