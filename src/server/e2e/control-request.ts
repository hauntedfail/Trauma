import type { E2eControlRequest } from "./control-types";

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const RESET_FIXTURES = new Set(["read_only", "backup_git"]);
const MATERIALIZED_FIXTURES = new Set([
  "reader_base",
  "browse_delete",
  "collection_archive",
]);
const FIXTURE_MUTATIONS = new Set([
  "moment_delete_focus_rows",
  "settings_translation_defaults",
  "flashback_warning_insert",
  "flashback_warning_unflashback",
]);
const LIST_INSPECTIONS = new Set(["moment_anchors", "flashback_ids"]);

export function parseE2eControlRequest(value: unknown): E2eControlRequest | null {
  if (!isRecord(value) || typeof value.action !== "string") {
    return null;
  }

  switch (value.action) {
    case "reset_fixture":
      return hasExactKeys(value, ["action", "fixture"]) &&
        typeof value.fixture === "string" &&
        RESET_FIXTURES.has(value.fixture)
        ? value as E2eControlRequest
        : null;
    case "materialize_fixture":
      return hasExactKeys(value, ["action", "fixture"]) &&
        typeof value.fixture === "string" &&
        MATERIALIZED_FIXTURES.has(value.fixture)
        ? value as E2eControlRequest
        : null;
    case "mutate_fixture_state":
      return hasExactKeys(value, ["action", "mutation"]) &&
        typeof value.mutation === "string" &&
        FIXTURE_MUTATIONS.has(value.mutation)
        ? value as E2eControlRequest
        : null;
    case "inspect_fixture_state":
      if (
        hasExactKeys(value, ["action", "inspection"]) &&
        typeof value.inspection === "string" &&
        LIST_INSPECTIONS.has(value.inspection)
      ) {
        return value as E2eControlRequest;
      }
      return hasExactKeys(value, ["action", "inspection", "memoryId"]) &&
        value.inspection === "persistence_state" &&
        typeof value.memoryId === "string" &&
        UUID_V7_PATTERN.test(value.memoryId)
        ? value as E2eControlRequest
        : null;
    default:
      return null;
  }
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
