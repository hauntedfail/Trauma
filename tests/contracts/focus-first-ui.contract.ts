export interface FocusFirstAcTestRef {
  readonly file: string;
  readonly title: string;
}

export type FocusFirstAcManifest = Readonly<
  Record<number, readonly FocusFirstAcTestRef[]>
>;

export const FOCUS_FIRST_UI_DOC_PATH = "docs/architecture/focus-first-ui.md";

/**
 * Machine-checked binding between each numbered acceptance criterion in
 * docs/architecture/focus-first-ui.md section 10 and the test(s) that verify it.
 *
 * Referenced titles must appear as plain string literals in their target files
 * so tests/contracts/focus-first-ui-contract.test.ts can verify every binding.
 */
export const FOCUS_FIRST_UI_AC_MANIFEST = {
  1: [
    {
      file: "e2e/browse-shell.spec.ts",
      title:
        "removes right rail completely at 1280x800 and keeps slim 56px left rail (AC 1)",
    },
  ],
  2: [
    {
      file: "e2e/browse-shell.spec.ts",
      title:
        "updates URL query state from Library search and Filters popover without debt counters (AC 2)",
    },
  ],
  3: [
    {
      file: "e2e/add-memory.spec.ts",
      title:
        "captures via a key, icon button, and palette into Shelf without ever opening a taxonomy prompt (AC 3)",
    },
  ],
  4: [
    {
      file: "e2e/browse-shell.spec.ts",
      title:
        "triages Shelf rows with p, l, x, u keys, persists across reload, enforces Today cap, and rolls back on failure (AC 4)",
    },
  ],
  5: [
    {
      file: "e2e/reader.spec.ts",
      title:
        "keeps reader text column between 55ch and 75ch and stationary when Psychiatrist sheet toggles at 1280px and 1920px (AC 5)",
    },
  ],
  6: [
    {
      file: "e2e/reader.spec.ts",
      title:
        "persists last_position on section 4, restores silently on reload, and shows continue at 4/N in Today (AC 6)",
    },
  ],
  7: [
    {
      file: "e2e/reader.spec.ts",
      title:
        "renders zero mid-text dialogs or alerts and fails silently on position persistence errors (AC 7)",
    },
  ],
  8: [
    {
      file: "e2e/browse-shell.spec.ts",
      title:
        "opens command palette via Ctrl/Cmd+K from every route, restores focus on Esc, and supports search, navigation, URL capture validation, and focus plugin toggles (AC 8)",
    },
  ],
  9: [
    {
      file: "e2e/cross-device-responsive.spec.ts",
      title:
        "renders exactly 4 phone bottom tabs (Today, Shelf, Library, More) with no disabled tabs (AC 9)",
    },
  ],
  10: [
    {
      file: "e2e/focus-first-a11y.spec.ts",
      title:
        "Today lane has zero serious or critical axe-core violations (AC 10)",
    },
    {
      file: "e2e/focus-first-a11y.spec.ts",
      title:
        "Shelf lane has zero serious or critical axe-core violations (AC 10)",
    },
    {
      file: "e2e/focus-first-a11y.spec.ts",
      title:
        "Library lane has zero serious or critical axe-core violations (AC 10)",
    },
    {
      file: "e2e/focus-first-a11y.spec.ts",
      title:
        "Reader has zero serious or critical axe-core violations with micro-surfaces closed and open (AC 10)",
    },
  ],
  11: [
    {
      file: "tests/server/db/schema.test.ts",
      title:
        "backfills focus-first triage_state and triage_changed_at from pre-0024 rows and enforces triage_state check (AC 11)",
    },
  ],
  12: [
    {
      file: "tests/components/memory-reader-actions.test.ts",
      title:
        "renders a clean focus-first canvas with topbar Translate & Details popovers, landmark rail, flashback marks, and quiet end footer without an Inspector button (AC 12)",
    },
    {
      file: "tests/components/memory-reader-actions.test.ts",
      title:
        "dismantles the 5-tab Inspector drawer in favor of spatially contiguous micro-surfaces (Landmark Rail Outline+Marks, topbar Translate & Details popovers, on-demand Psychiatrist sheet) (AC 12)",
    },
    {
      file: "e2e/reader.spec.ts",
      title:
        "renders no Inspector control or tabbed side drawer and keeps rare metadata and actions in the overflow popover (AC 12)",
    },
  ],
  13: [
    {
      file: "e2e/browse-shell.spec.ts",
      title:
        "renders destination triage labels without retired Pick, Not now, Keep, or Let go control names (AC 13)",
    },
  ],
  14: [
    {
      file: "tests/components/reader-margin-note.test.ts",
      title:
        "builds Simplify, Explain, and Ask payloads with grounded passage context (AC 14)",
    },
    {
      file: "tests/components/reader-margin-note.test.ts",
      title:
        "renders Simplify, Explain, and Ask-input states with passage snippet, Close, and Continue in Psychiatrist (AC 14)",
    },
    {
      file: "e2e/reader.spec.ts",
      title:
        "offers Simplify, Explain, and Ask on text selection and renders an in-situ margin note card with no chat surface open by default (AC 14)",
    },
  ],
  15: [
    {
      file: "e2e/reader.spec.ts",
      title:
        "opens Psychiatrist from overflow popover and command palette without shifting the reader column and returns focus on close (AC 15)",
    },
  ],
  16: [
    {
      file: "tests/server/agent-api/routes.test.ts",
      title:
        "returns documented JSON shape for /context and maps stored wordCount to lengthBucket or null when unset (AC 16)",
    },
    {
      file: "tests/server/agent-api/routes.test.ts",
      title:
        "returns documented JSON shape for /memories/:id with nullable wordCount and lengthBucket and 404 for missing memory (AC 16)",
    },
    {
      file: "tests/server/agent-api/routes.test.ts",
      title:
        "returns documented JSON shapes for /triage and /ask endpoints (AC 16)",
    },
    {
      file: "tests/server/agent-api/routes.test.ts",
      title:
        "returns 401 without echoing token for wrong bearer token across /api/agent/v1 endpoints when TRAUMA_API_TOKEN is configured (AC 16)",
    },
  ],
} as const satisfies FocusFirstAcManifest;
