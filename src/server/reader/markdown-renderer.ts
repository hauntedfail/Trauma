import hljs from "highlight.js";
import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import footnote from "markdown-it-footnote";
import sanitizeHtml from "sanitize-html";

export interface ReaderTocEntry {
  id: string;
  level: number;
  path: string;
  startOffset?: number;
  endOffset?: number;
  text: string;
}

export interface RenderedMemoryMarkdown {
  html: string;
  toc: ReaderTocEntry[];
}

const ALLOWED_IFRAME_HOSTNAMES = new Set([
  "player.vimeo.com",
  "www.youtube-nocookie.com",
  "www.youtube.com",
]);

export function renderMemoryMarkdown(markdown: string): RenderedMemoryMarkdown {
  const toc: ReaderTocEntry[] = [];
  const markdownIt = createMarkdownIt(toc);
  const rendered = markdownIt.render(markdown);

  return {
    html: sanitizeReaderHtml(rendered),
    toc,
  };
}

function createMarkdownIt(toc: ReaderTocEntry[]) {
  const headingPathTracker = createHeadingPathTracker();

  return new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
    highlight: (code, language) => highlightCode(code, language),
  })
    .use(taskListPlugin)
    .use(footnote)
    .use(anchor, {
      level: [1, 2, 3],
      slugify,
      tabIndex: false,
      callback: (token, info) => {
        const level = readHeadingLevel(token.tag);
        const path = nextHeadingPath(headingPathTracker, level);
        token.attrJoin("class", "trauma-reader-section-heading");
        token.attrSet("data-reader-section-anchor", info.slug);
        token.attrSet("data-reader-section-title", info.title);
        token.attrSet("data-reader-section-level", String(level));
        token.attrSet("data-reader-section-path", path);
        toc.push({
          id: info.slug,
          level,
          path,
          text: info.title,
        });
      },
    });
}

function highlightCode(code: string, language: string) {
  const highlighted = language.trim() !== "" && hljs.getLanguage(language)
    ? hljs.highlight(code, { language, ignoreIllegals: true }).value
    : hljs.highlightAuto(code).value;

  return `<pre><code class="hljs language-${escapeAttribute(language)}">${highlighted}</code></pre>`;
}

function sanitizeReaderHtml(html: string) {
  return sanitizeHtml(html, {
    allowedTags: [
      "a",
      "blockquote",
      "br",
      "code",
      "del",
      "div",
      "em",
      "figcaption",
      "figure",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "hr",
      "iframe",
      "img",
      "input",
      "li",
      "mark",
      "ol",
      "p",
      "picture",
      "pre",
      "s",
      "source",
      "span",
      "strong",
      "sub",
      "sup",
      "table",
      "tbody",
      "td",
      "tfoot",
      "th",
      "thead",
      "tr",
      "ul",
    ],
    allowedAttributes: {
      a: ["aria-label", "class", "href", "id", "name", "rel"],
      code: ["class"],
      div: ["class"],
      h1: [
        "class",
        "data-reader-section-anchor",
        "data-reader-section-level",
        "data-reader-section-path",
        "data-reader-section-title",
        "id",
      ],
      h2: [
        "class",
        "data-reader-section-anchor",
        "data-reader-section-level",
        "data-reader-section-path",
        "data-reader-section-title",
        "id",
      ],
      h3: [
        "class",
        "data-reader-section-anchor",
        "data-reader-section-level",
        "data-reader-section-path",
        "data-reader-section-title",
        "id",
      ],
      h4: ["id"],
      h5: ["id"],
      h6: ["id"],
      iframe: [
        "allowfullscreen",
        "loading",
        "referrerpolicy",
        "src",
        "title",
      ],
      img: [
        "alt",
        "decoding",
        "height",
        "loading",
        "sizes",
        "src",
        "srcset",
        "title",
        "width",
      ],
      input: ["checked", "class", "disabled", "type"],
      li: ["class", "id"],
      mark: ["data-highlight-id", "id"],
      ol: ["class"],
      section: ["class"],
      source: ["media", "sizes", "srcset", "type"],
      span: ["class"],
      sup: ["class", "id"],
      table: ["class"],
      td: ["align"],
      th: ["align"],
      ul: ["class"],
    },
    allowedClasses: {
      "*": [/^hljs(?:-[a-z0-9-]+)?$/, /^language-[a-z0-9-]+$/],
      a: ["footnote-backref"],
      input: ["task-list-item-checkbox"],
      li: ["footnote-item", "task-list-item"],
      ol: ["contains-task-list", "footnotes-list"],
      sup: ["footnote-ref"],
      ul: ["contains-task-list"],
    },
    allowedIframeHostnames: [...ALLOWED_IFRAME_HOSTNAMES],
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: {
      img: ["http", "https"],
    },
    allowProtocolRelative: false,
    exclusiveFilter: (frame) =>
      (frame.tag === "iframe" && !isAllowedIframeSource(frame.attribs.src)) ||
      (frame.tag === "input" && frame.attribs.type !== "checkbox"),
    transformTags: {
      a: sanitizeAnchor,
      iframe: sanitizeIframe,
      img: sanitizeImage,
      input: sanitizeTaskCheckbox,
      mark: sanitizeHighlightMark,
      source: sanitizePictureSource,
    },
  });
}

function taskListPlugin(md: MarkdownIt) {
  md.core.ruler.after("inline", "reader_task_lists", (state) => {
    for (let index = 0; index < state.tokens.length; index += 1) {
      const token = state.tokens[index];
      if (token === undefined || token.type !== "inline" || token.children === null) {
        continue;
      }

      const firstChild = token.children[0];
      const match = firstChild?.type === "text"
        ? /^\[([ xX])\]\s+/.exec(firstChild.content)
        : null;
      const taskState = match?.[1];
      if (match === null || firstChild === undefined || taskState === undefined) {
        continue;
      }

      const listItem = findOpenToken(state.tokens, index, "list_item_open");
      if (listItem === undefined) {
        continue;
      }

      const list = findOpenToken(state.tokens, index, "bullet_list_open")
        ?? findOpenToken(state.tokens, index, "ordered_list_open");
      list?.attrJoin("class", "contains-task-list");
      listItem.attrJoin("class", "task-list-item");
      firstChild.content = firstChild.content.slice(match[0].length);

      const checkbox = new state.Token("html_inline", "", 0);
      checkbox.content = `<input class="task-list-item-checkbox" type="checkbox" disabled${taskState.toLowerCase() === "x" ? " checked" : ""}> `;
      token.children.unshift(checkbox);
    }
  });
}

type MarkdownToken = ReturnType<MarkdownIt["parse"]>[number];
type HeadingPathTracker = Map<number, number>;

function createHeadingPathTracker(): HeadingPathTracker {
  return new Map<number, number>();
}

function nextHeadingPath(tracker: HeadingPathTracker, level: number): string {
  const normalizedLevel = Math.max(1, Math.min(6, level));
  tracker.set(normalizedLevel, (tracker.get(normalizedLevel) ?? 0) + 1);

  for (const key of [...tracker.keys()]) {
    if (key > normalizedLevel) {
      tracker.delete(key);
    }
  }

  return Array.from({ length: normalizedLevel }, (_value, index) => {
    const key = index + 1;
    return String(tracker.get(key) ?? 0);
  }).join("/");
}

function findOpenToken(
  tokens: MarkdownToken[],
  startIndex: number,
  tokenType: string,
) {
  for (let index = startIndex - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (token === undefined) {
      continue;
    }

    if (token.type === tokenType) {
      return token;
    }

    if (token.type === `${tokenType.replace("_open", "")}_close`) {
      return undefined;
    }
  }

  return undefined;
}

function sanitizeAnchor(_tagName: string, attribs: sanitizeHtml.Attributes) {
  const href = attribs.href;
  return {
    tagName: "a",
    attribs: {
      ...attribs,
      ...(href?.startsWith("http://") || href?.startsWith("https://")
        ? { rel: "nofollow noopener noreferrer" }
        : {}),
    },
  };
}

function sanitizeIframe(_tagName: string, attribs: sanitizeHtml.Attributes) {
  const { allow: _allow, ...safeAttribs } = attribs;
  return {
    tagName: "iframe",
    attribs: {
      ...safeAttribs,
      loading: attribs.loading ?? "lazy",
      referrerpolicy: "no-referrer",
    },
  };
}

function sanitizeImage(_tagName: string, attribs: sanitizeHtml.Attributes) {
  const { decoding: _decoding, sizes, srcset, ...safeAttribs } = attribs;
  const safeSourceSet = sanitizeSourceSet(srcset);
  return {
    tagName: "img",
    attribs: {
      ...safeAttribs,
      ...(safeSourceSet !== undefined
        ? {
            srcset: safeSourceSet,
            ...(sizes !== undefined ? { sizes } : {}),
          }
        : {}),
      decoding: "async",
      loading: attribs.loading ?? "lazy",
    },
  };
}

function sanitizePictureSource(
  _tagName: string,
  attribs: sanitizeHtml.Attributes,
): sanitizeHtml.Tag {
  const safeSourceSet = sanitizeSourceSet(attribs.srcset);
  if (safeSourceSet === undefined) {
    return {
      tagName: "span",
      attribs: {},
    };
  }

  return {
    tagName: "source",
    attribs: {
      ...(attribs.type !== undefined ? { type: attribs.type } : {}),
      ...(attribs.media !== undefined ? { media: attribs.media } : {}),
      srcset: safeSourceSet,
      ...(attribs.sizes !== undefined ? { sizes: attribs.sizes } : {}),
    },
  };
}

function sanitizeSourceSet(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const candidates = value
    .split(",")
    .map((candidate) => sanitizeSourceSetCandidate(candidate))
    .filter((candidate): candidate is string => candidate !== undefined);

  return candidates.length > 0 ? candidates.join(", ") : undefined;
}

function sanitizeSourceSetCandidate(value: string): string | undefined {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  const [rawUrl, descriptor] = parts;
  if (rawUrl === undefined || parts.length > 2) {
    return undefined;
  }

  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }

    if (descriptor === undefined) {
      return url.toString();
    }

    return isSafeSourceSetDescriptor(descriptor)
      ? `${url.toString()} ${descriptor}`
      : undefined;
  } catch {
    return undefined;
  }
}

function isSafeSourceSetDescriptor(value: string): boolean {
  return /^\d+w$/.test(value) || /^(?:\d+(?:\.\d+)?)x$/.test(value);
}

function sanitizeTaskCheckbox(_tagName: string, attribs: sanitizeHtml.Attributes) {
  return {
    tagName: "input",
    attribs: {
      class: "task-list-item-checkbox",
      type: "checkbox",
      disabled: "disabled",
      ...(attribs.checked !== undefined ? { checked: "checked" } : {}),
    },
  };
}

function sanitizeHighlightMark(
  _tagName: string,
  attribs: sanitizeHtml.Attributes,
): sanitizeHtml.Tag {
  const highlightId = attribs["data-highlight-id"];
  if (highlightId === undefined || highlightId.trim() === "") {
    return {
      tagName: "span",
      attribs: {},
    };
  }

  return {
    tagName: "mark",
    attribs: {
      "data-highlight-id": highlightId,
      id: highlightId,
    },
  };
}

function isAllowedIframeSource(src: string | undefined) {
  if (src === undefined) {
    return false;
  }

  try {
    const url = new URL(src);
    return (
      url.protocol === "https:" &&
      ALLOWED_IFRAME_HOSTNAMES.has(url.hostname) &&
      (url.pathname.startsWith("/embed/") || url.hostname === "player.vimeo.com")
    );
  } catch {
    return false;
  }
}

function readHeadingLevel(tag: string) {
  const level = Number.parseInt(tag.slice(1), 10);
  return Number.isInteger(level) ? level : 1;
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z0-9#]+;/gi, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return slug === "" ? "section" : slug;
}

function escapeAttribute(value: string) {
  return value.replace(/[^a-z0-9-]/gi, "");
}
