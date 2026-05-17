export const DEFAULT_TRANSLATION_TARGET_LANGUAGE = "ja-JP";

export const SUPPORTED_TRANSLATION_LANGUAGES = [
  { code: "ja-JP", label: "Japanese" },
  { code: "en-US", label: "English" },
  { code: "ko-KR", label: "Korean" },
  { code: "zh-CN", label: "Chinese" },
  { code: "fr-FR", label: "French" },
  { code: "de-DE", label: "German" },
  { code: "es-ES", label: "Spanish" },
  { code: "it-IT", label: "Italian" },
  { code: "pt-BR", label: "Portuguese" },
] as const;

export type SupportedLanguageCode =
  (typeof SUPPORTED_TRANSLATION_LANGUAGES)[number]["code"];

const supportedLanguageCodes = new Set<string>(
  SUPPORTED_TRANSLATION_LANGUAGES.map((language) => language.code),
);

export function isSupportedLanguageCode(
  value: string,
): value is SupportedLanguageCode {
  return supportedLanguageCodes.has(value);
}
