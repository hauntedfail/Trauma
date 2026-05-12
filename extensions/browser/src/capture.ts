import type { CaptureResult, CapturedTabSnapshot } from "./types";

const REMOVED_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "object",
  "embed",
  "canvas",
  "svg",
  "form",
  "input",
  "textarea",
  "select",
  "button",
];

export function createCapturedTabSnapshot(
  extensionVersion: string,
  maxBytes = 4_500_000,
): CaptureResult {
  if (location.protocol !== "http:" && location.protocol !== "https:") {
    return {
      ok: false,
      error: "TRAUMA can import only http and https pages.",
    };
  }

  const documentElement = document.documentElement.cloneNode(true);
  if (!(documentElement instanceof Element)) {
    return { ok: false, error: "Could not read the current page." };
  }

  sanitizeElement(documentElement);
  const html = `<!doctype html>\n${documentElement.outerHTML}`;
  if (new TextEncoder().encode(html).byteLength > maxBytes) {
    return { ok: false, error: "The current page is too large to import." };
  }

  return {
    ok: true,
    snapshot: {
      sourceUrl: location.href,
      canonicalUrl: readCanonicalUrl(),
      title: normalizeText(document.title),
      description: readDescription(),
      html,
      capturedAt: new Date().toISOString(),
      extensionVersion,
    },
  };
}

function sanitizeElement(root: Element) {
  for (const selector of REMOVED_SELECTORS) {
    for (const element of Array.from(root.querySelectorAll(selector))) {
      element.remove();
    }
  }

  for (const element of Array.from(root.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc") {
        element.removeAttribute(attribute.name);
      }
    }
  }
}

function readCanonicalUrl() {
  const value =
    document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? "";
  return normalizeText(value);
}

function readDescription() {
  const value =
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content ??
    document.querySelector<HTMLMetaElement>('meta[property="og:description"]')
      ?.content ??
    "";
  return normalizeText(value);
}

function normalizeText(value: string) {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
