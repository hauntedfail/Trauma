import { resolve } from "node:path";

import type { FlashbackVariant } from "./variant";

const variantMutationLocks = new Map<string, Promise<void>>();

export async function withFlashbackVariantMutationLock<T>(
  input: {
    memoryId: string;
    storePath: string;
    variant: FlashbackVariant;
  },
  operation: () => Promise<T>,
): Promise<T> {
  return withVariantMutationKey(createVariantMutationKey(input), operation);
}

export async function withTranslatedFlashbackProjectionMutationLock<T>(
  input: {
    langCode: string;
    memoryId: string;
    storePath: string;
  },
  operation: () => Promise<T>,
): Promise<T> {
  return withVariantMutationKey(
    `${resolve(input.storePath)}\0${input.memoryId}\0translation:${input.langCode}`,
    operation,
  );
}

async function withVariantMutationKey<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = variantMutationLocks.get(key) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolveCurrent) => {
    releaseCurrent = resolveCurrent;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  variantMutationLocks.set(key, queued);

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    releaseCurrent();
    if (variantMutationLocks.get(key) === queued) {
      variantMutationLocks.delete(key);
    }
  }
}

function createVariantMutationKey(input: {
  memoryId: string;
  storePath: string;
  variant: FlashbackVariant;
}): string {
  const artifactVariant = input.variant.kind === "source"
    ? "source"
    : `translation:${input.variant.langCode}`;
  return `${resolve(input.storePath)}\0${input.memoryId}\0${artifactVariant}`;
}
