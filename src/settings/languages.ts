export const DEFAULT_TRANSLATION_TARGET_LANGUAGE = "ja-JP";

export const SUPPORTED_TRANSLATION_LANGUAGES = [
  {
    code: "ja-JP",
    displayName: "Japanese",
    label: "Japanese",
    nativeName: "日本語",
  },
  {
    code: "en-US",
    displayName: "English (US)",
    label: "English (US)",
    nativeName: "English",
  },
  {
    code: "en-GB",
    displayName: "English (UK)",
    label: "English (UK)",
    nativeName: "English",
  },
  {
    code: "ko-KR",
    displayName: "Korean",
    label: "Korean",
    nativeName: "한국어",
  },
  {
    code: "zh-CN",
    displayName: "Chinese (Simplified)",
    label: "Chinese (Simplified)",
    nativeName: "简体中文",
  },
  {
    code: "zh-TW",
    displayName: "Chinese (Traditional)",
    label: "Chinese (Traditional)",
    nativeName: "繁體中文",
  },
  {
    code: "fr-FR",
    displayName: "French",
    label: "French",
    nativeName: "Français",
  },
  {
    code: "de-DE",
    displayName: "German",
    label: "German",
    nativeName: "Deutsch",
  },
  {
    code: "es-ES",
    displayName: "Spanish",
    label: "Spanish",
    nativeName: "Español",
  },
  {
    code: "pt-BR",
    displayName: "Portuguese (Brazil)",
    label: "Portuguese (Brazil)",
    nativeName: "Português (Brasil)",
  },
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
