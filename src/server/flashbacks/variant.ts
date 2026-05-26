import type { SupportedLanguageCode } from "../translation/languages";

export type FlashbackVariant =
  | { kind: "source" }
  | {
      kind: "translation";
      langCode: SupportedLanguageCode;
      outputHash: string;
    };

export interface FlashbackVariantColumns {
  variantKind: "source" | "translation";
  langCode: SupportedLanguageCode | null;
  translationOutputHash: string | null;
}

export const sourceFlashbackVariant: FlashbackVariant = { kind: "source" };

export function toFlashbackVariantColumns(
  variant: FlashbackVariant,
): FlashbackVariantColumns {
  if (variant.kind === "source") {
    return {
      variantKind: "source",
      langCode: null,
      translationOutputHash: null,
    };
  }

  return {
    variantKind: "translation",
    langCode: variant.langCode,
    translationOutputHash: variant.outputHash,
  };
}
