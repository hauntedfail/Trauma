# Headless Agent API Reference

TRAUMA exposes a versioned JSON REST and SSE surface under `/api/agent/v1/*` so
external agents and CLI clients share the same reading state, triage lifecycle,
and passage-grounded Psychiatrist contract as the reader UI (see
[Focus-first UI](../architecture/focus-first-ui.md)).

Source of truth for response types:
[`src/server/agent-api/types.ts`](../../src/server/agent-api/types.ts).

## Endpoints Overview

| Method | Path | Purpose | Success Status |
|---|---|---|---|
| `GET` | `/api/agent/v1/context` | Read active lanes (`today`, `shelf`) and most recently opened non-archived memory (`activeMemory`) | `200 OK` |
| `GET` | `/api/agent/v1/memories/:memoryId` | Read full canonical reading state for a memory (metadata, variant markdown, TOC, Flashbacks, Moments) | `200 OK` |
| `POST` | `/api/agent/v1/memories/:memoryId/triage` | Move a memory between triage lanes (`shelf`, `today`, `library`, `archive`) with optional Today cap enforcement | `200 OK` |
| `POST` | `/api/agent/v1/memories/:memoryId/ask` | Start a passage-grounded Psychiatrist turn (`simplify`, `explain`, `ask`) and return its SSE `eventsUrl` | `202 Accepted` |

## Authentication and Mutation Guards

Authentication is implemented in
[`src/server/http/api-auth.ts`](../../src/server/http/api-auth.ts) and optional
mutation guards in
[`src/server/http/mutation-request.ts`](../../src/server/http/mutation-request.ts).
See also [Local/self-hosting](../operations/local-self-hosting.md) for deployment
access control.

### Bearer Token (`TRAUMA_API_TOKEN`)

`TRAUMA_API_TOKEN` is an optional environment variable (trimmed; blank or
whitespace-only values are treated as unset):

- **Unset:** Requests pass as unauthenticated (`authenticated: false`).
- **Set, no `Authorization: Bearer ...` header (or non-Bearer scheme):**
  Requests pass as unauthenticated (`authenticated: false`) so local browser
  and reverse-proxy / Cloudflare Access flows continue unchanged.
- **Set, `Authorization: Bearer ...` header present:** The presented token is
  hashed with SHA-256 and compared against the configured token's SHA-256 digest
  using constant-time `timingSafeEqual` (so token length is not leaked).
  - Matching token: request proceeds as authenticated (`authenticated: true`).
  - Missing/empty bearer value or mismatch: returns `401 Unauthorized` with
    `{ "error": "invalid API token" }`. Token values are never logged or echoed
    in responses.

### Mutation Request Guards (`POST` Endpoints)

`POST /api/agent/v1/memories/:memoryId/triage` and
`POST /api/agent/v1/memories/:memoryId/ask` parse JSON bodies through
`readJsonMutationRequest`:

- **Authenticated Bearer requests** bypass browser `Origin` and `Sec-Fetch-Site`
  checks.
- **Unauthenticated browser requests** (those sending `Origin` or
  `Sec-Fetch-Site`) must match the request origin with `Sec-Fetch-Site` equal to
  `same-origin` or `none`, otherwise the server returns `403 Forbidden`
  (`{ "error": "same-origin request is required" }`), and must send
  `Content-Type: application/json`, otherwise `415 Unsupported Media Type`
  (`{ "error": "content-type must be application/json" }`).
- **Body size limit:** Requests exceeding `1,048,576` bytes (1 MiB) return
  `413 Payload Too Large` (`{ "error": "request body is too large" }`).
  `POST .../ask` additionally forwards to Psychiatrist thread/message handlers,
  which enforce a `16,384`-byte (16 KiB) JSON body limit.
- **Invalid or missing JSON body:** Returns `400 Bad Request`
  (`{ "error": "request body must be JSON" }`).

## Shared Types and Nullable `wordCount` / `lengthBucket`

### `MemoryTriageState`

`"shelf" | "today" | "library" | "archive"`

### `MemoryLastPosition`

Persisted reader position (`null` when never recorded):

```json
{
  "variant": "source",
  "headingId": "in-situ-assistance",
  "paragraphIndex": 3,
  "scrollRatio": 0.45,
  "updatedAt": "2026-06-05T10:00:00.000Z"
}
```

| Field | Type | Description |
|---|---|---|
| `variant` | `string` | Active variant identifier (for example `"source"` or a translation language code such as `"ja-JP"`). |
| `headingId` | `string \| null` | Nearest heading anchor ID, or `null`. |
| `paragraphIndex` | `number` | Zero-based paragraph index. |
| `scrollRatio` | `number` | Scroll fraction in `[0, 1]`. |
| `updatedAt` | `string` | ISO 8601 timestamp of the saved position. |

### `BrowseLengthBucket` and Nullable `wordCount` / `lengthBucket`

`getLengthBucket(wordCount)` in
[`src/components/memories/browse-data.ts`](../../src/components/memories/browse-data.ts)
maps a stored finite non-negative `wordCount` to a neutral bucket:

| `wordCount` | `lengthBucket` |
|---|---|
| `0` to `499` | `"short"` |
| `500` to `1500` | `"medium"` |
| `> 1500` | `"long"` |
| `null` (or negative / non-finite) | `null` |

Both `wordCount` (on `GET /api/agent/v1/memories/:memoryId`) and `lengthBucket`
(on `GET /api/agent/v1/context` and `GET /api/agent/v1/memories/:memoryId`) are
**nullable**. They are `null` whenever `memories.word_count` has no stored word
count, which occurs for:

1. A memory whose extraction failed or produced no stored word count.
2. Any memory captured before drizzle migration `0024` until
   `bun run db:migrate` has run its backfill (see
   [Configuration](configuration.md#database-migrations)).

When `memories.word_count` is populated, `wordCount` returns the stored integer
and `lengthBucket` returns `"short"`, `"medium"`, or `"long"`.

### `SupportedLanguageCode`

Supported translation language codes for `?lang=` and `langCode`:
`ja-JP`, `en-US`, `en-GB`, `ko-KR`, `zh-CN`, `zh-TW`, `fr-FR`, `de-DE`,
`es-ES`, `pt-BR`.

## Common Error Shapes

Most `/api/agent/v1/*` error responses return JSON with an `error` string and
optional structured fields:

```json
{
  "error": "memory was not found"
}
```

Certain errors include a machine-readable `code` (and extra details where noted
under each endpoint):

```json
{
  "error": "Today is full. Finish or return one first.",
  "code": "today_cap_reached",
  "todayCount": 3,
  "todayCap": 3
}
```

`POST /api/agent/v1/memories/:memoryId/ask` can also forward structured error
responses directly from the underlying Psychiatrist thread or message handler:

```json
{
  "status": "error",
  "code": "turn_conflict",
  "message": "A Psychiatrist turn is already running for this thread.",
  "action": "retry"
}
```

---

## `GET /api/agent/v1/context`

Returns the current `today` and `shelf` lanes plus the most recently opened
non-archived memory (`activeMemory`), without unread-debt counters.

### Query Parameters

| Parameter | Type | Default | Constraints |
|---|---|---|---|
| `shelfLimit` | integer | `50` | Optional. Integer from `1` to `100` inclusive. Empty value falls back to `50`. |

`today` is queried with a fixed limit of `50` sorted by `recent`. `shelf` is
sorted by `recent` up to `shelfLimit`. `activeMemory` is chosen from the 10
most recently opened memories (`sort: "last_opened"`) by taking the first row
whose `lastOpenedAt` is non-null and whose `triageState` is not `"archive"`.

### Response (`200 OK`) — `AgentContextResponse`

| Field | Type | Description |
|---|---|---|
| `today` | `AgentContextMemoryItem[]` | Memories in the `today` lane. |
| `shelf` | `AgentContextMemoryItem[]` | Memories in the `shelf` lane (up to `shelfLimit`). |
| `activeMemory` | `AgentActiveMemorySummary \| null` | Most recently opened non-archived memory, or `null` if none has been opened. |

#### `AgentContextMemoryItem`

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Memory ID. |
| `title` | `string` | Memory title. |
| `domain` | `string` | Hostname from the memory URL with leading `www.` stripped (falls back to raw URL if unparseable). |
| `lengthBucket` | `"short" \| "medium" \| "long" \| null` | Neutral length bucket derived from stored `wordCount`, or `null` when no word count is stored. |
| `lastPosition` | `MemoryLastPosition \| null` | Last saved reading position, or `null`. |
| `triageState` | `MemoryTriageState` | `"shelf" \| "today" \| "library" \| "archive"`. |

#### `AgentActiveMemorySummary`

Includes all fields of `AgentContextMemoryItem`, plus:

| Field | Type | Description |
|---|---|---|
| `lastOpenedAt` | `string` | ISO 8601 timestamp when the memory was last opened. |
| `read` | `boolean` | Whether the memory is marked read. |

```json
{
  "today": [
    {
      "id": "018f04a2-3c6f-7c88-9a8b-8c99a9b7f701",
      "title": "Attention Architecture",
      "domain": "example.com",
      "lengthBucket": "medium",
      "lastPosition": {
        "variant": "source",
        "headingId": "in-situ-assistance",
        "paragraphIndex": 3,
        "scrollRatio": 0.45,
        "updatedAt": "2026-06-05T10:00:00.000Z"
      },
      "triageState": "today"
    }
  ],
  "shelf": [
    {
      "id": "018f04a2-3c6f-7c88-9a8b-8c99a9b7f702",
      "title": "Gaze-to-Context",
      "domain": "research.org",
      "lengthBucket": "short",
      "lastPosition": null,
      "triageState": "shelf"
    }
  ],
  "activeMemory": {
    "id": "018f04a2-3c6f-7c88-9a8b-8c99a9b7f701",
    "title": "Attention Architecture",
    "domain": "example.com",
    "lengthBucket": "medium",
    "lastPosition": {
      "variant": "source",
      "headingId": "in-situ-assistance",
      "paragraphIndex": 3,
      "scrollRatio": 0.45,
      "updatedAt": "2026-06-05T10:00:00.000Z"
    },
    "triageState": "today",
    "lastOpenedAt": "2026-06-05T10:00:00.000Z",
    "read": false
  }
}
```

### Error Responses

| Status | Shape | Cause |
|---|---|---|
| `400` | `{ "error": "shelfLimit must be an integer between 1 and 100" }` | Non-integer or out-of-range `shelfLimit`. |
| `401` | `{ "error": "invalid API token" }` | `TRAUMA_API_TOKEN` is configured and a wrong Bearer token was sent. |
| `500` | `{ "error": "failed to load Trauma configuration" }` | Runtime configuration failed to load. |

### Example (`curl`)

```bash
curl -sS \
  -H "Authorization: Bearer $TRAUMA_API_TOKEN" \
  "http://127.0.0.1:3000/api/agent/v1/context?shelfLimit=20"
```

---

## `GET /api/agent/v1/memories/:memoryId`

Returns the full canonical reading state for one memory, including metadata,
taxonomy, available content variants, active variant markdown, table of
contents, Flashbacks, and Moments.

### Path and Query Parameters

| Location | Name | Type | Description |
|---|---|---|---|
| Path | `memoryId` | `string` | Required non-empty memory ID. |
| Query | `lang` | `SupportedLanguageCode` | Optional translation language code (for example `ja-JP`). Omit for the source variant. |

### Response (`200 OK`) — `AgentMemoryReadingStateResponse`

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Memory ID. |
| `url` | `string` | Source URL. |
| `domain` | `string` | Hostname with leading `www.` stripped. |
| `title` | `string` | Memory title. |
| `description` | `string \| null` | Memory summary/description, or `null`. |
| `faviconUrl` | `string \| null` | Favicon URL, or `null`. |
| `extractionStatus` | `string` | `"pending" \| "success" \| "link_only" \| "failed"`. |
| `read` | `boolean` | Read completion flag. |
| `triageState` | `MemoryTriageState` | `"shelf" \| "today" \| "library" \| "archive"`. |
| `triageChangedAt` | `string \| null` | ISO 8601 timestamp of last triage change, or `null`. |
| `lastPosition` | `MemoryLastPosition \| null` | Last saved reading position, or `null`. |
| `lastOpenedAt` | `string \| null` | ISO 8601 timestamp when last opened, or `null`. |
| `wordCount` | `number \| null` | Stored source word count, or `null` when unset. |
| `lengthBucket` | `"short" \| "medium" \| "long" \| null` | Derived from `wordCount`, or `null` when `wordCount` is `null`. |
| `capturedAt` | `string` | ISO 8601 capture timestamp (matches `createdAt`). |
| `createdAt` | `string` | ISO 8601 creation timestamp. |
| `updatedAt` | `string` | ISO 8601 update timestamp. |
| `categories` | `ReaderTaxonomyItem[]` | Assigned categories (`id`, `name`). |
| `tags` | `ReaderTaxonomyItem[]` | Assigned tags (`id`, `name`). |
| `activeVariant` | object | Active variant descriptor with `kind` (`"source" \| "translation"`), `langCode` (`SupportedLanguageCode \| null`), and `relativePath` (`string`). |
| `variants` | `ReaderContentVariant[]` | All available variants (`active`, `kind`, `label`, optional `langCode`, `readerUrl`, `relativePath`). |
| `markdown` | `string` | Raw markdown body of the active variant (`CONTENT.md` or translated variant). |
| `toc` | `ReaderTocEntry[]` | Rendered headings (`id`, `level`, `path`, optional `startOffset`, optional `endOffset`, `text`). |
| `flashbacks` | `ReaderFlashbackItem[]` | Flashback markers for the memory (`id`, `text`, `prefix`, `suffix`, `startOffset`, `endOffset`, optional `contentHash`, `variantKind`, optional `langCode`, optional `translationOutputHash`, `createdAt`). |
| `moments` | `ReaderMomentItem[]` | Saved section Moments (`id`, `sectionAnchor`, `sectionTitle`, `sectionLevel`, `sectionPath`, `sectionStartOffset`, `sectionEndOffset`, optional `contentHash`, `createdAt`). |

### Error Responses

| Status | Shape | Cause |
|---|---|---|
| `400` | `{ "error": "memoryId must be a non-empty string" }` | Blank `memoryId`. |
| `400` | `{ "error": "lang must be a supported translation language" }` | Unsupported `lang` query value. |
| `401` | `{ "error": "invalid API token" }` | Wrong Bearer token when `TRAUMA_API_TOKEN` is set. |
| `404` | `{ "error": "memory was not found" }` | Memory ID does not exist. |
| `404` | `{ "error": "...", "code": "content_missing" }` | Memory `CONTENT.md` or requested translation variant is missing. |
| `500` | `{ "error": "failed to load Trauma configuration" }` | Runtime configuration failed to load. |
| `503` | `{ "error": "...", "code": "unavailable" }` | Reader state is temporarily unavailable. |

### Example (`curl`)

```bash
# Source variant
curl -sS \
  -H "Authorization: Bearer $TRAUMA_API_TOKEN" \
  "http://127.0.0.1:3000/api/agent/v1/memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f701"

# Translated variant
curl -sS \
  -H "Authorization: Bearer $TRAUMA_API_TOKEN" \
  "http://127.0.0.1:3000/api/agent/v1/memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f701?lang=ja-JP"
```

---

## `POST /api/agent/v1/memories/:memoryId/triage`

Transitions a memory's `triageState` through the canonical triage service,
enforcing the optional `todayCap` when moving into `today`.

### Path Parameters

| Name | Type | Description |
|---|---|---|
| `memoryId` | `string` | Required non-empty memory ID. |

### Request Body (JSON)

Only the fields below are allowed; unknown keys are rejected with `400`. Both
camelCase and snake_case aliases are accepted; if both forms of the same field
are supplied, their values must match.

| Field | Alias | Type | Required | Description |
|---|---|---|---|---|
| `triageState` | `triage_state` | `MemoryTriageState` | Yes | Target lane: `"shelf"`, `"today"`, `"library"`, or `"archive"`. |
| `todayCap` | `today_cap` | `number \| null` | No | Optional non-negative integer cap for the `today` lane, or `null` for uncapped. |

### Response (`200 OK`) — `AgentTriageResponse`

| Field | Type | Description |
|---|---|---|
| `memoryId` | `string` | Memory ID. |
| `triageState` | `MemoryTriageState` | Persisted triage state after the request. |
| `triageChangedAt` | `string` | ISO 8601 timestamp of the triage state. |
| `changed` | `boolean` | `true` if the state changed, `false` if already in the target state. |

```json
{
  "memoryId": "018f04a2-3c6f-7c88-9a8b-8c99a9b7f702",
  "triageState": "library",
  "triageChangedAt": "2026-06-05T10:15:00.000Z",
  "changed": true
}
```

### Error Responses

| Status | Shape | Cause |
|---|---|---|
| `400` | `{ "error": "..." }` | Blank `memoryId`, invalid JSON, non-object body, unknown key, invalid/mismatched `triageState`/`triage_state`, or invalid/mismatched `todayCap`/`today_cap`. |
| `401` | `{ "error": "invalid API token" }` | Wrong Bearer token when `TRAUMA_API_TOKEN` is set. |
| `403` | `{ "error": "same-origin request is required" }` | Cross-origin browser request without a valid Bearer token. |
| `404` | `{ "error": "memory was not found" }` | Memory ID does not exist. |
| `409` | `{ "error": "Today is full. Finish or return one first.", "code": "today_cap_reached", "todayCount": <n>, "todayCap": <n> }` | Target is `"today"` and the current count meets or exceeds `todayCap`. |
| `413` | `{ "error": "request body is too large" }` | Body exceeds 1 MiB. |
| `415` | `{ "error": "content-type must be application/json" }` | Unauthenticated browser request with non-JSON `Content-Type`. |
| `500` | `{ "error": "failed to load Trauma configuration" }` | Runtime configuration failed to load. |

### Example (`curl`)

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $TRAUMA_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"triageState":"today","todayCap":3}' \
  "http://127.0.0.1:3000/api/agent/v1/memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f702/triage"
```

---

## `POST /api/agent/v1/memories/:memoryId/ask`

Builds a passage-grounded prompt for `simplify`, `explain`, or `ask`, starts or
resumes a memory-scoped Psychiatrist thread, dispatches a detached turn, and
returns `202 Accepted` with the SSE stream URL (`eventsUrl`).

### Path Parameters

| Name | Type | Description |
|---|---|---|
| `memoryId` | `string` | Required non-empty memory ID. |

### Request Body (JSON)

Only the eight keys below are allowed; unknown keys are rejected with `400`.
Empty or whitespace-only optional strings (and `null`) are treated as omitted.

| Field | Type | Required | Constraints / Default |
|---|---|---|---|
| `action` | `"simplify" \| "explain" \| "ask"` | Yes | One of `AGENT_ASK_ACTIONS`. |
| `selectedText` | `string \| null` | No | Max `2,000` trimmed chars. |
| `sectionAnchor` | `string \| null` | No | Max `256` trimmed chars. Used to resolve `sectionTitle` from `toc` when `sectionTitle` is omitted, and to extract a section excerpt (up to `800` chars) when `selectedText` is omitted. |
| `sectionTitle` | `string \| null` | No | Max `512` trimmed chars. Overrides TOC lookup when provided. |
| `prompt` | `string \| null` | Conditional | Required when `action` is `"ask"`. Optional extra focus for `"simplify"` / `"explain"`. Max `2,000` trimmed chars. |
| `langCode` | `SupportedLanguageCode \| null` | No | Max `32` chars; must be a supported translation language code. Omit for `"source"` variant. |
| `resumeLatest` | `boolean` | No | Default `true`. When `true`, resumes the latest compatible Psychiatrist thread for the memory variant; when `false`, creates a new thread. |
| `webSourcePermission` | `"deny" \| "allow_for_this_turn"` | No | Default `"deny"`. Controls whether the Psychiatrist turn may request external web sources. |

The composed prompt is truncated to `4,000` characters
(`PSYCHIATRIST_MAX_USER_MESSAGE_CHARS`) before being sent to Psychiatrist.

### Response (`202 Accepted`) — `AgentAskResponse`

| Field | Type | Description |
|---|---|---|
| `threadId` | `string` | Psychiatrist thread ID. |
| `turnId` | `string` | Started Psychiatrist turn ID. |
| `pairId` | `string` | User/assistant exchange pair ID. |
| `eventsUrl` | `string` | Relative URL of the turn's SSE event stream (`/api/memories/:memoryId/psychiatrist/threads/:threadId/turns/:turnId/events?variant_kind=...[&lang_code=...]`). |
| `groundedContext` | `AgentAskGroundedContext` | Normalized grounding metadata attached to the turn. |

#### `AgentAskGroundedContext`

| Field | Type | Description |
|---|---|---|
| `action` | `"simplify" \| "explain" \| "ask"` | Requested action. |
| `memoryId` | `string` | Memory ID. |
| `memoryTitle` | `string` | Memory title. |
| `domain` | `string` | Normalized source domain. |
| `variantKind` | `"source" \| "translation"` | `"translation"` when `langCode` was provided, otherwise `"source"`. |
| `langCode` | `SupportedLanguageCode \| null` | Translation language code, or `null` for source. |
| `sectionAnchor` | `string \| null` | Normalized section anchor, or `null`. |
| `sectionTitle` | `string \| null` | Explicit or TOC-resolved section heading text, or `null`. |
| `selectedText` | `string \| null` | Normalized selected passage, or `null`. |
| `prompt` | `string \| null` | Normalized user question or additional focus, or `null`. |

```json
{
  "threadId": "0195a1b2-c3d4-7000-8000-000000000001",
  "turnId": "0195a1b2-c3d4-7000-8000-000000000002",
  "pairId": "0195a1b2-c3d4-7000-8000-000000000003",
  "eventsUrl": "/api/memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f701/psychiatrist/threads/0195a1b2-c3d4-7000-8000-000000000001/turns/0195a1b2-c3d4-7000-8000-000000000002/events?variant_kind=source",
  "groundedContext": {
    "action": "explain",
    "memoryId": "018f04a2-3c6f-7c88-9a8b-8c99a9b7f701",
    "memoryTitle": "Attention Architecture",
    "domain": "example.com",
    "variantKind": "source",
    "langCode": null,
    "sectionAnchor": "in-situ-assistance",
    "sectionTitle": "In-Situ Assistance",
    "selectedText": "Selection-anchored margin notes",
    "prompt": null
  }
}
```

### Error Responses

Route-level errors (`{ "error": "...", "code"?: "..." }`):

| Status | Cause |
|---|---|
| `400` | Blank `memoryId`, invalid JSON, non-object body, unknown key, invalid `action`, missing `prompt` for `action: "ask"`, over-length string, unsupported `langCode`, invalid `resumeLatest`, or invalid `webSourcePermission`. |
| `401` | Wrong Bearer token when `TRAUMA_API_TOKEN` is set (`{ "error": "invalid API token" }`). |
| `403` | Cross-origin browser request without a valid Bearer token. |
| `404` | Memory was not found (`{ "error": "memory was not found" }`). |
| `409` | Memory `CONTENT.md` or requested translation file is missing (`code: "context_unavailable"`). |
| `413` | Request body exceeds size limit. |
| `415` | Unauthenticated browser request with non-JSON `Content-Type`. |
| `500` | Configuration load failure or unexpected Psychiatrist thread/turn initialization payload. |
| `503` | Reader state unavailable (`code: "unavailable"`). |

Forwarded Psychiatrist errors (`{ "status": "error", "code", "message", "action" }`):

| Status | `code` Examples | Cause |
|---|---|---|
| `409` | `thread_stale`, `turn_conflict`, `thread_scope_mismatch` | Thread content hash/policy changed, another turn is running on the thread, or variant scope mismatches. |
| `429` | `turn_capacity_exceeded` (includes `Retry-After: 1`) | Global Psychiatrist concurrent-turn capacity reached. |
| `503` | `runtime_isolation_required` | Codex runtime isolation env var is not enabled for production Psychiatrist turns. |
| `500` | `auth_required`, `app_server_unavailable`, `timeout`, `event_limit_exceeded`, `unknown` | Downstream Codex app-server failure. |

### Streaming SSE Events (`GET <eventsUrl>`)

Connect to the returned `eventsUrl` with `GET` to stream live turn progress and
durable replay (`Content-Type: text/event-stream; charset=utf-8`).

- **Resume / replay:** Pass `?after_event_id=<eventId>` or the `Last-Event-ID`
  request header to receive only events after that ID.
- **Variant scope:** `eventsUrl` already includes `variant_kind` (and
  `lang_code` for translations). Invalid query params return plain-text `400`;
  mismatched thread/variant scope returns plain-text `404`.
- **Wire format:** Each SSE frame has `id: <eventId>`, `event: <type>`, and
  `data: <JSON>`, where the JSON envelope is a `PsychiatristStreamEvent`:

```json
{
  "eventId": "000000000001",
  "timestamp": 1700000000000,
  "memoryId": "018f04a2-3c6f-7c88-9a8b-8c99a9b7f701",
  "threadId": "0195a1b2-c3d4-7000-8000-000000000001",
  "turnId": "0195a1b2-c3d4-7000-8000-000000000002",
  "type": "psychiatrist.answer.delta",
  "data": {
    "text": "Selection-anchored margin notes keep context local."
  }
}
```

#### Event Types

| `event` (`type`) | Terminal | `data` Shape | Description |
|---|---|---|---|
| `psychiatrist.turn.started` | No | `{ "pair_id": string, "status": "running", "user_prompt": string }` | Turn accepted and started. |
| `psychiatrist.process.delta` | No | `{ "text": string }` | Safe status/progress line (no hidden reasoning or credentials). |
| `psychiatrist.answer.delta` | No | `{ "text": string }` | Incremental answer text chunk. |
| `psychiatrist.answer.completed` | Yes | `{ "pair_id": string, "text": string, "source_citations": [{ "source_id": string, "title": string, "url": string }], "warning"?: { "code": string, "message": string } }` | Final persisted answer and sanitized citations. Stream closes after this event. |
| `psychiatrist.answer.failed` | Yes | `{ "code": string, "message"?: string, "pair_id"?: string }` | Safe failure code (for example `timeout`, `event_limit_exceeded`, `turn_interrupted`, `unknown`). Stream closes after this event. |
| `psychiatrist.network.permission_required` | Yes | `{ "code": "network_permission_required", "message": string, "pair_id": string, "retry_action": "allow_web_sources", "retry_mode": "first_answer", "retry_turn_id": string, "user_prompt": string }` | Turn required external web access while `webSourcePermission` was `"deny"`. Retry with `"allow_for_this_turn"` if appropriate. |
| `psychiatrist.turn.canceled` | Yes | `{ "status": "canceled", "warning"?: { "code": string, "message": string } }` | Turn was canceled. Stream closes after this event. |
| `psychiatrist.thread.stale` | No | `{ "status": "stale" }` | Thread content hash diverged from the stored memory content. |
| `psychiatrist.regenerate.started` | No | *(Psychiatrist regenerate stream)* | Emitted when regenerating an answer on the same thread stream schema. |
| `psychiatrist.regenerate.completed` | Yes | *(Psychiatrist regenerate stream)* | Terminal completion event for a regenerate turn. |

### Examples (`curl`)

```bash
# 1. Start a passage-grounded ask turn (202 Accepted)
curl -sS -X POST \
  -H "Authorization: Bearer $TRAUMA_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "ask",
    "sectionAnchor": "in-situ-assistance",
    "selectedText": "Selection-anchored margin notes",
    "prompt": "Summarize this idea in two bullet points."
  }' \
  "http://127.0.0.1:3000/api/agent/v1/memories/018f04a2-3c6f-7c88-9a8b-8c99a9b7f701/ask"

# 2. Stream SSE events from the returned eventsUrl
curl -sS -N \
  -H "Accept: text/event-stream" \
  "http://127.0.0.1:3000/api/memories/<memoryId>/psychiatrist/threads/<threadId>/turns/<turnId>/events?variant_kind=source"
```

## Related Documents

- [Focus-first UI](../architecture/focus-first-ui.md)
- [Glossary](glossary.md)
- [Configuration](configuration.md)
- [Local/self-hosting](../operations/local-self-hosting.md)
