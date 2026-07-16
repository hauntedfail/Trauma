import type { SupportedLanguageCode } from "../../settings/languages";

export interface ReaderGenerationIdentity {
  readonly langCode?: SupportedLanguageCode;
  readonly memoryId: string;
}

export interface ReaderGenerationSnapshot extends ReaderGenerationIdentity {
  readonly generation: number;
}

export interface ReaderGenerationGuard {
  activate: (identity: ReaderGenerationIdentity) => ReaderGenerationSnapshot;
  capture: () => ReaderGenerationSnapshot;
  invalidate: () => void;
  isCurrent: (snapshot: ReaderGenerationSnapshot) => boolean;
}

export function createReaderGenerationGuard(
  initialIdentity: ReaderGenerationIdentity,
): ReaderGenerationGuard {
  let active = true;
  let generation = 1;
  let identity = copyReaderGenerationIdentity(initialIdentity);

  const capture = (): ReaderGenerationSnapshot => ({
    ...identity,
    generation,
  });

  return {
    activate(nextIdentity) {
      if (active && isSameReaderGenerationIdentity(identity, nextIdentity)) {
        return capture();
      }

      active = true;
      generation += 1;
      identity = copyReaderGenerationIdentity(nextIdentity);
      return capture();
    },
    capture,
    invalidate() {
      active = false;
      generation += 1;
    },
    isCurrent(snapshot) {
      return active &&
        snapshot.generation === generation &&
        isSameReaderGenerationIdentity(identity, snapshot);
    },
  };
}

function copyReaderGenerationIdentity(
  identity: ReaderGenerationIdentity,
): ReaderGenerationIdentity {
  return {
    langCode: identity.langCode,
    memoryId: identity.memoryId,
  };
}

function isSameReaderGenerationIdentity(
  left: ReaderGenerationIdentity,
  right: ReaderGenerationIdentity,
): boolean {
  return left.memoryId === right.memoryId && left.langCode === right.langCode;
}
