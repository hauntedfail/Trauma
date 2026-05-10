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
      "input",
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
        "allowfullscreen",
        "loading",
        "referrerpolicy",
        "src",
        "title",
      ],
      img: ["alt", "height", "loading", "src", "title", "width"],
      input: ["checked", "class", "disabled", "type"],
      li: ["class", "id"],
      mark: ["data-highlight-id", "id"],
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
  return {
    tagName: "img",
    attribs: {
      ...attribs,
      loading: attribs.loading ?? "lazy",
    },
  };
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
