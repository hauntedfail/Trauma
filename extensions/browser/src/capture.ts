import type { CaptureResult, ExtractionStrategy } from "./types";

interface ExtractionCandidate {
  element: Element;
  selector: string;
  extractionStrategy: ExtractionStrategy;
}

type CaptureElementResult =
  | { ok: true; element: Element }
  | { ok: false; error: string };

type CandidateResult =
  | { ok: true; candidate: ExtractionCandidate }
  | { ok: false; error: string };

const REMOVED_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
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

const SEMANTIC_SELECTORS = ["article", "main", '[role="main"]'] as const;
const MAX_SHADOW_SEARCH_NODES = 5_000;
const MAX_CAPTURE_SAFETY_NODES = 100_000;
const CAPTURE_INCOMPLETE_ERROR =
  "Could not capture the complete readable content.";
const CAPTURE_TOO_LARGE_ERROR = "The current page is too large to import.";
const CAPTURE_IFRAME_SANDBOX =
  "allow-scripts allow-presentation";
const textEncoder = new TextEncoder();

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

  const candidate = selectExtractionCandidate(document, maxBytes);
  if (!candidate.ok) {
    return { ok: false, error: candidate.error };
  }

  const articleHtml = candidate.candidate.element.outerHTML;
  const articleText = normalizeReadableText(
    candidate.candidate.element.textContent ?? "",
  );

  if (
    articleText.length === 0 &&
    !hasMeaningfulMedia(candidate.candidate.element)
  ) {
    return { ok: false, error: "Could not find readable page content." };
  }

  if (byteLength(articleHtml) > maxBytes) {
    return { ok: false, error: CAPTURE_TOO_LARGE_ERROR };
  }

  const snapshot = {
    sourceUrl: location.href,
    canonicalUrl: readCanonicalUrl(),
    title: normalizeText(document.title),
    description: readDescription(),
    articleHtml,
    articleText,
    selector: candidate.candidate.selector,
    extractionStrategy: candidate.candidate.extractionStrategy,
    capturedAt: new Date().toISOString(),
    extensionVersion,
  };

  if (byteLength(JSON.stringify(snapshot)) > maxBytes) {
    return { ok: false, error: CAPTURE_TOO_LARGE_ERROR };
  }

  return {
    ok: true,
    snapshot,
  };
}

function selectExtractionCandidate(
  liveDocument: Document,
  maxBytes: number,
): CandidateResult {
  let captureError: string | null = null;

  for (const selector of SEMANTIC_SELECTORS) {
    const candidate = selectBestClonedElement(
      querySelectorAllDeep(liveDocument, selector),
      maxBytes,
    );
    if (!candidate.ok) {
      captureError ??= candidate.error;
      continue;
    }

    if (candidate.element !== null) {
      return {
        ok: true,
        candidate: {
          element: candidate.element,
          selector,
          extractionStrategy: "semantic_selector",
        },
      };
    }
  }

  const documentElement = cloneElementWithinByteBudget(
    liveDocument.documentElement,
    maxBytes,
  );
  if (!documentElement.ok) {
    return documentElement;
  }
  if (!sanitizeElement(documentElement.element)) {
    return { ok: false, error: CAPTURE_INCOMPLETE_ERROR };
  }

  const body = documentElement.element.querySelector("body");
  return body === null
    ? {
        ok: false,
        error: captureError ?? "Could not find readable page content.",
      }
    : {
        ok: true,
        candidate: {
          element: body,
          selector: "body",
          extractionStrategy: "body_fallback",
        },
      };
}

function querySelectorAllDeep(root: ParentNode, selector: string): Element[] {
  const results: Element[] = [];
  const queue: ParentNode[] = [root];
  const visited = new Set<ParentNode>();
  let inspected = 0;

  while (queue.length > 0 && inspected < MAX_SHADOW_SEARCH_NODES) {
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
      if (inspected >= MAX_SHADOW_SEARCH_NODES) {
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

function cloneElementWithinByteBudget(
  sourceRoot: Element,
  maxBytes: number,
): CaptureElementResult {
  const rootClone = sourceRoot.cloneNode(false);
  if (!(rootClone instanceof Element)) {
    return { ok: false, error: CAPTURE_INCOMPLETE_ERROR };
  }

  const queue: { source: Element; clone: Element }[] = [
    { source: sourceRoot, clone: rootClone },
  ];
  let inspected = 0;
  let estimatedBytes = estimateElementShellBytes(rootClone);

  while (queue.length > 0) {
    if (inspected >= MAX_CAPTURE_SAFETY_NODES) {
      return { ok: false, error: CAPTURE_INCOMPLETE_ERROR };
    }

    const current = queue.shift();
    if (current === undefined) {
      continue;
    }

    inspected += 1;
    const childNodes = [
      ...Array.from(current.source.childNodes),
      ...(current.source.shadowRoot === null
        ? []
        : Array.from(current.source.shadowRoot.childNodes)),
    ];
    for (const child of childNodes) {
      if (inspected >= MAX_CAPTURE_SAFETY_NODES) {
        return { ok: false, error: CAPTURE_INCOMPLETE_ERROR };
      }

      inspected += 1;
      if (child.nodeType === 1) {
        const childClone = child.cloneNode(false);
        if (!(child instanceof Element) || !(childClone instanceof Element)) {
          continue;
        }
        const childBytes = estimateElementShellBytes(childClone);
        if (estimatedBytes + childBytes > maxBytes) {
          return { ok: false, error: CAPTURE_TOO_LARGE_ERROR };
        }

        current.clone.appendChild(childClone);
        estimatedBytes += childBytes;
        queue.push({ source: child, clone: childClone });
        continue;
      }

      if (child.nodeType === 3) {
        const childBytes = estimateTextNodeBytes(child.textContent ?? "");
        if (estimatedBytes + childBytes > maxBytes) {
          return { ok: false, error: CAPTURE_TOO_LARGE_ERROR };
        }

        current.clone.appendChild(child.cloneNode(false));
        estimatedBytes += childBytes;
      }
    }
  }

  return { ok: true, element: rootClone };
}

function selectBestClonedElement(
  elements: readonly Element[],
  maxBytes: number,
): { ok: true; element: Element | null } | { ok: false; error: string } {
  let best: Element | null = null;
  let bestScore = 0;
  let captureError: string | null = null;

  for (const element of elements) {
    const clone = cloneElementWithinByteBudget(element, maxBytes);
    if (!clone.ok) {
      captureError ??= clone.error;
      continue;
    }

    if (!sanitizeElement(clone.element)) {
      captureError ??= CAPTURE_INCOMPLETE_ERROR;
      continue;
    }

    const score = scoreExtractionElement(clone.element);
    if (score > bestScore) {
      best = clone.element;
      bestScore = score;
    }
  }

  if (bestScore > 0) {
    return { ok: true, element: best };
  }

  return captureError === null
    ? { ok: true, element: null }
    : { ok: false, error: captureError };
}

function scoreExtractionElement(element: Element) {
  return normalizeReadableText(element.textContent ?? "").length +
    countMeaningfulMedia(element) * 300;
}

function hasMeaningfulMedia(element: Element) {
  return countMeaningfulMedia(element) > 0;
}

function countMeaningfulMedia(element: Element) {
  return element.querySelectorAll("img[src], iframe[src], picture img[src]").length;
}

function sanitizeElement(root: Element) {
  const queue: Element[] = [root];
  let inspected = 0;

  while (queue.length > 0) {
    if (inspected >= MAX_CAPTURE_SAFETY_NODES) {
      return false;
    }

    const element = queue.shift();
    if (element === undefined) {
      continue;
    }
    inspected += 1;

    if (isRemovedElement(element)) {
      element.remove();
      continue;
    }

    if (element.localName.toLowerCase() === "iframe" && !sanitizeIframeElement(element)) {
      element.remove();
      continue;
    }

    if (element.localName.toLowerCase() === "img" && !sanitizeImageElement(element)) {
      element.remove();
      continue;
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc") {
        element.removeAttribute(attribute.name);
      }
    }

    queue.push(...childElements(element));
  }

  return true;
}

function estimateElementShellBytes(element: Element) {
  return byteLength(element.outerHTML);
}

function estimateTextNodeBytes(value: string) {
  return byteLength(
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;"),
  );
}

function byteLength(value: string) {
  return textEncoder.encode(value).byteLength;
}

function isRemovedElement(element: Element) {
  return REMOVED_SELECTORS.includes(element.localName.toLowerCase());
}

function sanitizeIframeElement(element: Element) {
  if (element.getAttribute("srcdoc") !== null) {
    return false;
  }

  const src = resolveCaptureMediaUrl(element.getAttribute("src"));
  if (src === null) {
    return false;
  }

  const title = element.getAttribute("title");
  const width = sanitizeDimension(element.getAttribute("width"));
  const height = sanitizeDimension(element.getAttribute("height"));
  const allowfullscreen = element.getAttribute("allowfullscreen") !== null;
  clearAttributes(element);
  element.setAttribute("src", src);
  element.setAttribute("loading", "lazy");
  element.setAttribute("referrerpolicy", "no-referrer");
  element.setAttribute("sandbox", CAPTURE_IFRAME_SANDBOX);
  if (title !== null && title.trim() !== "") {
    element.setAttribute("title", title.trim());
  }
  if (width !== null) {
    element.setAttribute("width", width);
  }
  if (height !== null) {
    element.setAttribute("height", height);
  }
  if (allowfullscreen) {
    element.setAttribute("allowfullscreen", "");
  }

  return true;
}

function sanitizeImageElement(element: Element) {
  const src = resolveCaptureMediaUrl(element.getAttribute("src"));
  if (src === null) {
    return false;
  }

  element.setAttribute("src", src);
  return true;
}

function clearAttributes(element: Element) {
  for (const attribute of Array.from(element.attributes)) {
    element.removeAttribute(attribute.name);
  }
}

function resolveCaptureMediaUrl(value: string | null) {
  if (value === null || value.trim() === "") {
    return null;
  }

  try {
    const url = new URL(value, location.href);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      isBlockedCaptureHostname(url.hostname)
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

function sanitizeDimension(value: string | null) {
  return value !== null && /^\d{1,5}$/.test(value) ? value : null;
}

function isBlockedCaptureHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return (
    normalized === "" ||
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    isIpv4CaptureHostname(normalized) ||
    normalized.includes(":")
  );
}

function isIpv4CaptureHostname(hostname: string) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
    return false;
  }

  const octets = hostname.split(".").map((part) => Number.parseInt(part, 10));
  return octets.every(
    (octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255,
  );
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
