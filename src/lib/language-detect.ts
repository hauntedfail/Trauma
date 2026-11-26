export type ReaderFontPreset = "sans" | "serif" | "focus" | "mono";

export const DEFAULT_READER_FONT_PRESET: ReaderFontPreset = "sans";
export const READER_FONT_STORAGE_KEY = "trauma.reader-font";

const RTL_LANG_PREFIXES = new Set(["ar", "fa", "he", "ur", "yi", "ps", "sd"]);

const SIMPLIFIED_MARKERS =
  /[这为说时来后会国学发对动经进现开发点种关头长问体实义]/g;
const TRADITIONAL_MARKERS =
  /[這為說時來後會國學發對動經進現開發點種關頭長問體實義]/g;

export function normalizeBcp47Lang(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").trim().replace(/_/g, "-");
  if (trimmed === "") {
    return "";
  }
  const lower = trimmed.toLowerCase();
  if (lower === "zh-cn" || lower === "zh-sg" || lower === "zh-hans") {
    return "zh-Hans";
  }
  if (
    lower === "zh-tw" ||
    lower === "zh-hk" ||
    lower === "zh-mo" ||
    lower === "zh-hant"
  ) {
    return "zh-Hant";
  }
  if (lower === "jp" || lower.startsWith("ja")) {
    return "ja";
  }
  if (lower.startsWith("ko")) {
    return "ko";
  }
  const [primary, region] = lower.split("-");
  if (!primary) {
    return "";
  }
  if (region && region.length === 2) {
    return `${primary}-${region.toUpperCase()}`;
  }
  return primary;
}

export function isRtlLanguage(lang: string): boolean {
  const primary = lang.trim().toLowerCase().split("-")[0] ?? "";
  return RTL_LANG_PREFIXES.has(primary);
}

/**
 * Fast, deterministic BCP-47 language detector for reader typography and CSS `:lang()` rules.
 * Prioritizes explicit variant `langCode` when provided; otherwise inspects Unicode script ratios.
 */
export function detectArticleLanguage(input: {
  langCode?: string | null;
  text?: string | null;
  title?: string | null;
}): string {
  const explicit = normalizeBcp47Lang(input.langCode);
  if (explicit !== "") {
    return explicit;
  }

  const sample = `${input.title ?? ""} ${(input.text ?? "").slice(0, 2400)}`
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, " ");

  if (sample.trim() === "") {
    return "en";
  }

  const kanaCount = (sample.match(/[\u3040-\u309F\u30A0-\u30FF]/g) ?? []).length;
  if (kanaCount >= 3) {
    return "ja";
  }

  const hangulCount = (sample.match(/[\uAC00-\uD7AF\u1100-\u11FF]/g) ?? []).length;
  if (hangulCount >= 3) {
    return "ko";
  }

  const hanCount = (sample.match(/[\u4E00-\u9FFF]/g) ?? []).length;
  if (hanCount >= 6) {
    const simplified = (sample.match(SIMPLIFIED_MARKERS) ?? []).length;
    const traditional = (sample.match(TRADITIONAL_MARKERS) ?? []).length;
    return traditional > simplified ? "zh-Hant" : "zh-Hans";
  }

  const arabicCount = (sample.match(/[\u0600-\u06FF\u0750-\u077F]/g) ?? []).length;
  if (arabicCount >= 6) {
    return "ar";
  }

  const hebrewCount = (sample.match(/[\u0590-\u05FF]/g) ?? []).length;
  if (hebrewCount >= 6) {
    return "he";
  }

  const devanagariCount = (sample.match(/[\u0900-\u097F]/g) ?? []).length;
  if (devanagariCount >= 6) {
    return "hi";
  }

  const thaiCount = (sample.match(/[\u0E00-\u0E7F]/g) ?? []).length;
  if (thaiCount >= 6) {
    return "th";
  }

  const cyrillicCount = (sample.match(/[\u0400-\u04FF]/g) ?? []).length;
  if (cyrillicCount >= 10) {
    return "ru";
  }

  const greekCount = (sample.match(/[\u0370-\u03FF]/g) ?? []).length;
  if (greekCount >= 10) {
    return "el";
  }

  return "en";
}

export function isReaderFontPreset(value: string | null): value is ReaderFontPreset {
  return value === "sans" || value === "serif" || value === "focus" || value === "mono";
}
