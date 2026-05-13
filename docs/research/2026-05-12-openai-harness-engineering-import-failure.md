# OpenAI Harness Engineering URL Import Failure Report

Date: 2026-05-12
Branch: `triage/ui`
Target URL: <https://openai.com/ja-JP/index/harness-engineering/>

## Scope

This report investigates one concrete failure:

When the target URL is submitted through Add memory, TRAUMA creates a link-only
memory instead of extracting the article body.

This report does not design the browser extension fallback. It only records the
observed cause for this URL and the most practical fix direction.

## Current Result

Running the current importer directly against the target URL returns:

```json
{
  "status": "link_only",
  "title": "openai.com",
  "url": "https://openai.com/ja-JP/index/harness-engineering/",
  "extractionError": "fetch failed: HTTP 403"
}
```

The failure happens before Defuddle receives HTML. The current Add memory result
is therefore not a Defuddle article-selection failure and not a Markdown
serialization failure.

## Reproduction Command

```bash
mise exec -- bun --eval 'import { importUrl } from "./src/server/importer/index.ts"; const result = await importUrl({ url: "https://openai.com/ja-JP/index/harness-engineering/", timeoutMs: 20000 }); console.log(JSON.stringify({ status: result.status, title: result.title, url: result.url, extractionError: result.status === "link_only" ? result.extractionError : null, markdownLength: result.status === "success" ? result.markdown.length : null }, null, 2));'
```

Observed with network access:

```text
status: link_only
extractionError: fetch failed: HTTP 403
```

Note: without network access in the sandbox, DNS resolution can return an empty
address list and fail earlier with `url must target a public HTTP(S) host`. That
is a sandbox artifact, not the target application failure.

## HTTP Evidence

Plain `curl`:

```bash
curl -I -L --max-time 20 https://openai.com/ja-JP/index/harness-engineering/
```

Observed headers include:

```text
HTTP/2 403
server: cloudflare
cf-mitigated: challenge
content-type: text/html; charset=UTF-8
content-length: 9626
```

Browser-like User-Agent did not resolve the block:

```bash
curl -I -L --max-time 20 -A 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' https://openai.com/ja-JP/index/harness-engineering/
```

Observed headers still include:

```text
HTTP/2 403
server: cloudflare
cf-mitigated: challenge
content-length: 9903
```

The downloaded 403 body is a Cloudflare/OpenAI challenge page. It contains a
noscript message asking the client to enable JavaScript and cookies, plus
`/cdn-cgi/challenge-platform/...` scripts.

## Comparison With Browser-Readable Content

The target article itself exists and is readable in a browser context. The web
view resolves the page title and body content, including the article title,
author, date, and paragraphs.

This matters because the failure is not "the page has no readable content." The
server-side HTTP client is denied access to the real page and receives a
challenge document instead.

## Current Importer Boundary

Relevant implementation path:

```text
src/server/importer/index.ts
  importUrl()
  -> normalizeImportUrl()
  -> fetchWithValidatedRedirects()
  -> response.ok check
  -> readBoundedResponseText()
  -> extractArticleWithDefuddle()
```

For this URL, the request stops at the `response.ok` check:

```ts
if (!response.ok) {
  await cancelResponseBody(response);
  clearTimeout(timeout);
  return linkOnly(currentUrl, fallbackTitleFromUrl(currentUrl), {
    reason: "fetch failed",
    detail: `HTTP ${response.status}`,
  });
}
```

Because the response is `403`, the importer cancels the body and returns
`link_only`. Defuddle never sees the page.

## Root Cause

Root cause:

The target OpenAI URL is protected by Cloudflare managed challenge for the local
server-side HTTP clients used by TRAUMA. The current importer is a bounded
server-side fetcher, not a browser. It does not execute challenge JavaScript,
maintain browser challenge cookies, or provide a real browser fingerprint.

Important details:

- The response status is `403`.
- The response explicitly includes `cf-mitigated: challenge`.
- A browser-like User-Agent alone still receives `403`.
- The response body is not the article body.
- Current importer correctly refuses to persist the challenge page as content.

## Why The Current Link-Only Fallback Is Expected

Given the current architecture, this behavior is expected:

- `link_only` is the designed fallback for failed fetches.
- A `403` response is treated as failed fetch.
- Persisting the Cloudflare challenge body would be wrong.
- Defuddle cannot solve a fetch denial because it only processes HTML that the
  importer already obtained.

So the symptom is user-visible import failure, but the code path is behaving
consistently with its current server-side fetch contract.

## Candidate Fixes

### Recommended: Challenge-Aware Browser-Assisted Fallback

For this URL class, the practical fix is a browser-assisted import fallback:

1. Server-side import attempts the URL.
2. If the response is a challenge response, TRAUMA records a specific
   `challenge_detected` style reason while still creating or preparing a
   link-only memory.
3. UI offers a browser-assisted retry path.
4. A browser extension or local browser bridge sends already-loaded page content
   from the real browser context to TRAUMA.
5. Server validates the payload and writes `CONTENT.md` through the existing
   store path.

For the target URL, this is the only robust path observed in this investigation:
browser context can access the article; server-side HTTP clients receive a
challenge.

### Also Recommended: Better Fetch Failure Classification

Even before extension work, improve diagnostics:

- Detect `cf-mitigated: challenge`.
- Classify the result as `fetch challenge` or `anti-bot challenge` in
  `extractionError`.
- Avoid showing this as a generic "check the URL" failure.
- Keep the memory link-only unless a browser-assisted payload is supplied.

This does not extract the article, but it makes the failure actionable.

### Not Recommended: User-Agent Spoofing As The Fix

Changing only `User-Agent` is not sufficient for this URL. A browser-like
User-Agent still received `HTTP 403` and `cf-mitigated: challenge`.

Adding more browser headers may reduce failures for some sites, but it does not
solve Cloudflare challenge flows in a principled way and risks turning the
importer into an anti-bot bypass attempt.

### Not Recommended: Persisting The 403 Body

The 403 body is a challenge page, not article content. Persisting it would create
bad memories and could introduce unsafe or useless challenge markup into the
Markdown store.

## Proposed Task Split

If this becomes implementation work, split it separately from the Defuddle
extractor task:

1. **Importer challenge diagnostics**
   - Detect known challenge headers/body patterns.
   - Preserve `link_only` behavior.
   - Surface a clearer `extractionError`.
   - Add tests with a synthetic `cf-mitigated: challenge` response.

2. **Browser-assisted import contract**
   - Define a server endpoint for extracted page payloads.
   - Define payload schema: source URL, title, canonical URL, HTML or Markdown
     content, captured timestamp, and optional metadata.
   - Validate URL and payload before writing `CONTENT.md`.
   - Reuse the same store and DB metadata path as normal Add memory.

3. **Extension or browser bridge**
   - Content script reads the current document or reader-mode content.
   - Sends payload to the local TRAUMA instance.
   - Handles user confirmation and visible failure states.

4. **Security review**
   - Treat extension-supplied content as untrusted.
   - Do not allow arbitrary local file writes.
   - Restrict local endpoint exposure.
   - Keep auth/token story explicit if TRAUMA is not strictly local.

## Immediate Product Implication

For `https://openai.com/ja-JP/index/harness-engineering/`, server-side import is
blocked before extraction. The current link-only result is the correct safe
fallback for the current implementation.

The right resolution is not a Defuddle tweak. It is either:

- classify this failure accurately and leave it link-only, or
- add a browser-assisted import fallback that can capture content from a real
  browser session.
