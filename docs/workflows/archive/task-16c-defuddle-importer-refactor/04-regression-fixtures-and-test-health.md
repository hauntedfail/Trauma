# Task 16c.4: Regression Fixtures And Test Health

## Goal

Add fixture coverage that makes Defuddle extraction quality and safety
regressions reproducible without relying on live websites.

## Ownership

Primary files:

- `tests/server/importer/importer.test.ts`
- `tests/server/importer/extractor.test.ts`
- Create fixture files under `tests/fixtures/importer/**` if inline HTML makes
  the tests too large.

Optional files:

- `tests/server/reader/markdown-renderer.test.ts` if Defuddle-extracted content
  introduces reader-relevant Markdown shapes not already covered.

## Fixture Domains

Create deterministic fixtures for these domains:

- Simple article: title, description, favicon, article body.
- Cluttered page: nav, header, sidebar, comments, footer, and one real article.
- Rich content: headings, lists, code block, table, blockquote, footnote-like
  markup, and images.
- Hostile content: scripts, inline event handlers, `javascript:` links, URL
  userinfo, private-host links, and fake Markdown in text nodes.
- Thin content: article exists but readable body is below the threshold.
- Malformed HTML: unclosed tags and nested blocks that the old regex path would
  parse poorly.

## Test Rules

- Do not fetch live pages in unit tests.
- Keep expected Markdown assertions semantic and stable. Prefer checking key
  preserved/removed fragments over exact whole-document strings unless exact
  formatting is part of the contract.
- Keep security assertions exact. Unsafe schemes, userinfo, private URLs, script
  tags, and event handler attributes must not survive in an active form.
- Preserve existing timeout and response-size tests.
- If fixture output changes because Defuddle improves formatting, update the
  assertion and explain the behavior in the test name.

## Verification

```bash
mise exec -- bun run test tests/server/importer/importer.test.ts
mise exec -- bun run test tests/server/importer/extractor.test.ts
mise exec -- bun run test tests/server/reader/markdown-renderer.test.ts
```

## Acceptance Criteria

- Import extraction can be reviewed without live websites.
- Fixture tests cover both quality and security.
- Tests do not mask importer failures with browse fixtures or reader-only
  assertions.
- Markdown generated from Defuddle-extracted content remains compatible with the
  reader sanitizer.
