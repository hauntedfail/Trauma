const loadedScripts = new Set<string>();

/**
 * Dynamically loads non-EN/JA Fontsource stylesheets only when an article's
 * detected language requires that script. Zero initial payload for EN/JA views.
 */
export async function ensureMultilingualFontLoaded(lang: string): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  const normalized = lang.trim().toLowerCase();
  if (normalized === "" || normalized.startsWith("en") || normalized.startsWith("ja")) {
    return;
  }

  let key = "";
  let loader: (() => Promise<unknown>) | undefined;

  if (normalized.startsWith("ko")) {
    key = "ko";
    loader = () => import("@fontsource-variable/noto-sans-kr");
  } else if (
    normalized === "zh-hant" ||
    normalized === "zh-tw" ||
    normalized === "zh-hk" ||
    normalized === "zh-mo"
  ) {
    key = "zh-hant";
    loader = () => import("@fontsource-variable/noto-sans-tc");
  } else if (normalized.startsWith("zh")) {
    key = "zh-hans";
    loader = () => import("@fontsource-variable/noto-sans-sc");
  } else if (
    normalized.startsWith("ar") ||
    normalized.startsWith("fa") ||
    normalized.startsWith("ur")
  ) {
    key = "ar";
    loader = () =>
      Promise.all([
        import("@fontsource/ibm-plex-sans-arabic/400.css"),
        import("@fontsource/ibm-plex-sans-arabic/600.css"),
        import("@fontsource/ibm-plex-sans-arabic/700.css"),
      ]);
  } else if (normalized.startsWith("hi") || normalized.startsWith("mr")) {
    key = "devanagari";
    loader = () => import("@fontsource-variable/noto-sans-devanagari");
  } else if (normalized.startsWith("th")) {
    key = "th";
    loader = () => import("@fontsource-variable/noto-sans-thai");
  }

  if (key === "" || loader === undefined || loadedScripts.has(key)) {
    return;
  }

  loadedScripts.add(key);
  try {
    await loader();
  } catch {
    loadedScripts.delete(key);
  }
}
