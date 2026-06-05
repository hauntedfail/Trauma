# 24.10.2 Source Citation URL Policy

## Goal

Replace ad hoc query-token sanitization with a deterministic source URL
projection policy for web citations. The sanitizer is the final boundary before
source URLs are stored in thread artifacts and rendered in the reader, so it
must define what is preserved, not just which tokens are removed.

## Files Owned

- Modify: `src/server/psychiatrist/source-citations.ts`
- Modify: `tests/server/psychiatrist/source-citations.test.ts`

If the implementation needs shared host policy helpers, split this workflow
before coding and create a child plan for that helper and its tests.

## Current Fragility

The current implementation deletes selected query keys such as `token`,
`signature`, and `sig`. That fails as a contract because signed or
credential-bearing URLs can use short aliases, vendor-specific names, fragments,
userinfo, or private callback hosts. The safe rule must be a URL projection
rule, not an expanding denylist.

## Required Policy

Implement one canonical projection function used by citation extraction and
tests:

1. Parse the candidate with `new URL`.
2. Accept only `http:` and `https:` URLs.
3. Reject local, loopback, private, link-local, and empty hosts. This includes
   `localhost`, `.localhost`, IPv4 private ranges, IPv6 loopback/private
   equivalents, and hostless URLs.
4. Clear `username`, `password`, `hash`, and the entire query string.
5. Normalize the remaining URL through the URL API before returning it.
6. Reject URLs whose normalized string exceeds the citation URL length limit.
7. Return `undefined` for invalid, rejected, or non-URL input.

The default rule is to drop all query parameters. If a future product need
requires safe query preservation, that must be a separate allowlist with tests
for every preserved key. Do not preserve queries by default.

## Required Test Matrix

Add failing tests before implementation for these cases:

| Input | Expected |
| --- | --- |
| `https://example.com/article?sig=abc` | `https://example.com/article` |
| `https://example.com/article?X-Amz-Signature=abc&X-Amz-Credential=def` | `https://example.com/article` |
| `https://user:pass@example.com/a?utm_source=x#frag` | `https://example.com/a` |
| `https://example.com/a?redirect=https%3A%2F%2Fsecret.example%2F` | `https://example.com/a` |
| `https://localhost/a` | rejected |
| `http://127.0.0.1/a` | rejected |
| `http://10.0.0.5/a` | rejected |
| `file:///tmp/a` | rejected |
| `javascript:alert(1)` | rejected |
| malformed text | rejected |

Also add an extraction-level test proving that a citation returned from Codex
with a signed URL is persisted only as the projected URL.

## Implementation Notes

- Keep title/text sanitization separate from URL projection.
- Do not expose why a URL was rejected to the browser; tests may inspect the
  returned `undefined`.
- Do not add network calls to validate source URLs.
- Do not rely on regular expressions for URL parsing when the URL API can parse
  the candidate.

## Verification

```bash
mise exec -- bun run test tests/server/psychiatrist/source-citations.test.ts
mise exec -- bun run test tests/server/psychiatrist/api-routes.test.ts -t "source"
git diff --check
```
