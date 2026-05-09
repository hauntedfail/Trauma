import hljs from "highlight.js";
import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import footnote from "markdown-it-footnote";
import sanitizeHtml from "sanitize-html";

export interface ReaderTocEntry {
  id: string;
  level: number;
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
  return new MarkdownIt({
    html: true,
    linkify: false,
    typographer: false,
    highlight: (code, language) => highlightCode(code, language),
  })
    .use(footnote)
    .use(anchor, {
      level: [1, 2, 3],
      slugify,
      tabIndex: false,
      callback: (_token, info) => {
        toc.push({
          id: info.slug,
          level: readHeadingLevel(_token.tag),
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
      "li",
      "mark",
      "ol",
      "p",
      "pre",
      "s",
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
      h1: ["id"],
      h2: ["id"],
      h3: ["id"],
      h4: ["id"],
      h5: ["id"],
      h6: ["id"],
      iframe: [
        "allow",
        "allowfullscreen",
        "loading",
        "referrerpolicy",
        "src",
        "title",
      ],
      img: ["alt", "height", "loading", "src", "title", "width"],
      li: ["class", "id"],
      mark: ["data-highlight-id"],
      ol: ["class"],
      section: ["class"],
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
      li: ["footnote-item"],
      ol: ["footnotes-list"],
      sup: ["footnote-ref"],
    },
    allowedIframeHostnames: [...ALLOWED_IFRAME_HOSTNAMES],
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: {
      img: ["http", "https"],
    },
    allowProtocolRelative: false,
    exclusiveFilter: (frame) =>
      frame.tag === "iframe" && !isAllowedIframeSource(frame.attribs.src),
    transformTags: {
      a: sanitizeAnchor,
      iframe: sanitizeIframe,
      img: sanitizeImage,
    },
  });
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
  return {
    tagName: "iframe",
    attribs: {
      ...attribs,
      loading: attribs.loading ?? "lazy",
      referrerpolicy: attribs.referrerpolicy ?? "no-referrer",
    },
  };
}

function sanitizeImage(_tagName: string, attribs: sanitizeHtml.Attributes) {
  return {
    tagName: "img",
    attribs: {
      ...attribs,
      loading: attribs.loading ?? "lazy",
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
