# Task 16c.2: Extraction Adapter

## Goal

Add a narrow Defuddle adapter that accepts already-fetched HTML and returns
Trauma's internal extracted article shape.

## Ownership

Primary files:

- Create: `src/server/importer/extractor.ts`
- Modify: `src/server/importer/index.ts` only to export or use shared types if
  required.
- Test: `tests/server/importer/extractor.test.ts`

## Adapter Contract

The adapter should expose a function with this shape:

```ts
export interface ExtractArticleInput {
  html: string;
  pageUrl: string;
}

export interface ExtractedArticle {
  title: string;
  description: string | null;
  faviconUrl: string | null;
  markdown: string;
  wordCount: number | null;
}

export async function extractArticleWithDefuddle(
  input: ExtractArticleInput,
): Promise<ExtractedArticle>;
```

## Implementation Rules

- Defuddle receives a DOM `Document` created from `input.html`.
- Defuddle receives `input.pageUrl` as URL context.
- Use `{ markdown: false, useAsync: false, includeReplies: false }`.
- Convert Defuddle's cleaned HTML into persisted Markdown through Trauma-owned
  serialization so text-node Markdown and raw HTML cannot become active content.
- Do not fetch from inside the adapter.
- Do not read config, DB, filesystem, or backup state from the adapter.
- Normalize blank or missing metadata to the existing Trauma shapes.
- Keep the adapter pure except for Defuddle's parsing work.

## Expected Defuddle Call Shape

```ts
import { Defuddle } from "defuddle/node";
import { parseHTML } from "linkedom";

const { document } = parseHTML(input.html);
const result = await Defuddle(document, input.pageUrl, {
  markdown: false,
  useAsync: false,
  includeReplies: false,
});
```

## Tests

Create focused tests that do not use network:

- Extracts title, description, favicon, and Markdown from an article fixture.
- Removes nav/sidebar/footer content that the old heuristic could keep.
- Returns safe Markdown content for headings, links, images, and text extracted
  from Defuddle's cleaned HTML.
- Returns empty Markdown as `""` rather than throwing when Defuddle returns no
  usable content.
- Converts thrown Defuddle errors into explicit thrown adapter errors that the
  importer integration can map to link-only fallback.

## Verification

```bash
mise exec -- bun run test tests/server/importer/extractor.test.ts
mise exec -- bun run typecheck
```

## Acceptance Criteria

- Defuddle usage is isolated to one adapter module.
- Adapter tests cover success and failure shapes.
- The adapter has no direct URL fetching path.
- The adapter can be replaced later without changing `addMemory()`.
