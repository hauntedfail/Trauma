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
const CAPTURE_IFRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-presentation";

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

  const documentElement = cloneElementWithinTraversalLimit(document.documentElement);
  if (documentElement === null) {
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
      const clone = cloneElementWithinTraversalLimit(candidate);
      if (clone === null) {
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

function cloneElementWithinTraversalLimit(sourceRoot: Element) {
  const rootClone = sourceRoot.cloneNode(false);
  if (!(rootClone instanceof Element)) {
    return null;
  }

  const queue: { source: Element; clone: Element }[] = [
    { source: sourceRoot, clone: rootClone },
  ];
  let inspected = 0;

  while (queue.length > 0 && inspected < MAX_SHADOW_TRAVERSAL_NODES) {
    const current = queue.shift();
    if (current === undefined) {
      continue;
    }

    inspected += 1;
    for (const child of Array.from(current.source.childNodes)) {
      if (inspected >= MAX_SHADOW_TRAVERSAL_NODES) {
        break;
      }

      inspected += 1;
      if (child.nodeType === 1) {
        const childClone = child.cloneNode(false);
        if (!(child instanceof Element) || !(childClone instanceof Element)) {
          continue;
        }

        current.clone.appendChild(childClone);
        queue.push({ source: child, clone: childClone });
        continue;
      }

      if (child.nodeType === 3) {
        current.clone.appendChild(child.cloneNode(false));
      }
    }
  }

  return rootClone;
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
  const queue: Element[] = [root];
  let inspected = 0;

  while (queue.length > 0) {
    if (inspected >= MAX_SHADOW_TRAVERSAL_NODES) {
      for (const element of queue) {
        element.remove();
      }
      return;
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
