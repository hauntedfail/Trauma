import type { CaptureResult, ExtractionStrategy } from "./types";

interface ExtractionCandidate {
  element: Element;
  selector: string;
  extractionStrategy: ExtractionStrategy;
}

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

const SITE_SPECIFIC_SELECTORS = [
  {
    hostnameSuffix: "openai.com",
    selectors: ['[data-testid="page-content"]', "main article", "main"],
  },
] as const;

const SEMANTIC_SELECTORS = ["article", "main", '[role="main"]'] as const;
const MAX_SHADOW_TRAVERSAL_NODES = 5_000;

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
  const candidate = selectExtractionCandidate(document, documentElement);
  if (candidate === null) {
    return { ok: false, error: "Could not find readable page content." };
  }

  const articleHtml = candidate.element.outerHTML;
  const articleText = normalizeReadableText(candidate.element.textContent ?? "");

  if (articleText.length === 0) {
    return { ok: false, error: "Could not find readable page content." };
  }

  if (new TextEncoder().encode(articleHtml).byteLength > maxBytes) {
    return { ok: false, error: "The current page is too large to import." };
  }

  const snapshot = {
    sourceUrl: location.href,
    canonicalUrl: readCanonicalUrl(),
    title: normalizeText(document.title),
    description: readDescription(),
    articleHtml,
    articleText,
    selector: candidate.selector,
    extractionStrategy: candidate.extractionStrategy,
    capturedAt: new Date().toISOString(),
    extensionVersion,
  };

  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > maxBytes) {
    return { ok: false, error: "The current page is too large to import." };
  }

  return {
    ok: true,
    snapshot,
  };
}

function selectExtractionCandidate(
  liveDocument: Document,
  sanitizedDocumentElement: Element,
): ExtractionCandidate | null {
  const siteCandidate = selectSiteSpecificCandidate(liveDocument);
  if (siteCandidate !== null) {
    return siteCandidate;
  }

  for (const selector of SEMANTIC_SELECTORS) {
    const candidate = selectBestElement(
      Array.from(sanitizedDocumentElement.querySelectorAll(selector)),
    );
    if (candidate !== null) {
      return {
        element: candidate,
        selector,
        extractionStrategy: "semantic_selector",
      };
    }
  }

  const body = sanitizedDocumentElement.querySelector("body");
  return body === null
    ? null
    : {
        element: body,
        selector: "body",
        extractionStrategy: "body_fallback",
      };
}

function selectSiteSpecificCandidate(liveDocument: Document) {
  const hostname = location.hostname.toLowerCase();
  const selectorGroup = SITE_SPECIFIC_SELECTORS.find(
    (group) =>
      hostname === group.hostnameSuffix ||
      hostname.endsWith(`.${group.hostnameSuffix}`),
  );
  if (selectorGroup === undefined) {
    return null;
  }

  for (const selector of selectorGroup.selectors) {
    const candidate = selectBestElement(querySelectorAllDeep(liveDocument, selector));
    if (candidate !== null) {
      const clone = candidate.cloneNode(true);
      if (!(clone instanceof Element)) {
        continue;
      }
      sanitizeElement(clone);
      return {
        element: clone,
        selector,
        extractionStrategy: "site_selector" as const,
      };
    }
  }

  return null;
}

function querySelectorAllDeep(root: ParentNode, selector: string): Element[] {
  const results: Element[] = [];
  const queue: ParentNode[] = [root];
  const visited = new Set<ParentNode>();
  let inspected = 0;

  while (queue.length > 0 && inspected < MAX_SHADOW_TRAVERSAL_NODES) {
    const current = queue.shift();
    if (current === undefined || visited.has(current)) {
      continue;
    }
    visited.add(current);

    if (current instanceof Element && current.matches(selector)) {
      results.push(current);
    }

    for (const element of childElements(current)) {
      inspected += 1;
      if (inspected >= MAX_SHADOW_TRAVERSAL_NODES) {
        break;
      }

      queue.push(element);
      if (element.shadowRoot !== null && !visited.has(element.shadowRoot)) {
        queue.push(element.shadowRoot);
      }
    }
  }

  return results;
}

function childElements(parent: ParentNode) {
  if (!("children" in parent)) {
    return [];
  }

  return Array.from(parent.children as HTMLCollectionOf<Element>);
}

function selectBestElement(elements: readonly Element[]) {
  let best: Element | null = null;
  let bestLength = 0;

  for (const element of elements) {
    const textLength = normalizeReadableText(element.textContent ?? "").length;
    if (textLength > bestLength) {
      best = element;
      bestLength = textLength;
    }
  }

  return bestLength > 0 ? best : null;
}

function sanitizeElement(root: Element) {
  for (const selector of REMOVED_SELECTORS) {
    for (const element of Array.from(root.querySelectorAll(selector))) {
      element.remove();
    }
  }

  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
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
  const normalized = normalizeReadableText(value);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeReadableText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
