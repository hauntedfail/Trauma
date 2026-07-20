import {
  E2E_CONTROL_MAX_TOKEN_BYTES,
  E2E_CONTROL_MIN_TOKEN_BYTES,
  E2E_CONTROL_TOKEN_HEADER,
  type E2eControlRequest,
  type E2ePersistenceState,
  type InspectFixtureStateRequest,
  type MaterializeFixtureRequest,
  type MutateFixtureStateRequest,
  type ResetFixtureRequest,
} from "../src/server/e2e/control-types";

const E2E_CONTROL_URL = "http://127.0.0.1:4173/api/e2e-control";

export async function resetE2eFixture(
  fixture: ResetFixtureRequest["fixture"],
): Promise<void> {
  assertAcknowledgement(await sendE2eControlRequest({
    action: "reset_fixture",
    fixture,
  }));
}

export async function materializeE2eFixture(
  fixture: MaterializeFixtureRequest["fixture"],
): Promise<void> {
  assertAcknowledgement(await sendE2eControlRequest({
    action: "materialize_fixture",
    fixture,
  }));
}

export async function mutateE2eFixtureState(
  mutation: MutateFixtureStateRequest["mutation"],
): Promise<void> {
  assertAcknowledgement(await sendE2eControlRequest({
    action: "mutate_fixture_state",
    mutation,
  }));
}

export async function inspectE2eFixtureValues(
  inspection: Extract<
    InspectFixtureStateRequest,
    { inspection: "moment_anchors" | "flashback_ids" }
  >["inspection"],
): Promise<string[]> {
  const response = await sendE2eControlRequest({
    action: "inspect_fixture_state",
    inspection,
  });
  if (!hasExactKeys(response, ["ok", "values"]) ||
      response.ok !== true ||
      !Array.isArray(response.values) ||
      !response.values.every((value) => typeof value === "string")) {
    throw new Error("E2E fixture control returned an invalid list response");
  }
  return response.values;
}

export async function inspectE2ePersistenceState(
  memoryId: string,
): Promise<E2ePersistenceState> {
  const response = await sendE2eControlRequest({
    action: "inspect_fixture_state",
    inspection: "persistence_state",
    memoryId,
  });
  if (!hasExactKeys(response, ["ok", "state"]) ||
      response.ok !== true ||
      !isPersistenceState(response.state)) {
    throw new Error("E2E fixture control returned an invalid persistence response");
  }
  return response.state;
}

async function sendE2eControlRequest(
  request: E2eControlRequest,
): Promise<unknown> {
  const token = process.env.TRAUMA_E2E_CONTROL_TOKEN;
  const tokenBytes = token === undefined ? 0 : Buffer.byteLength(token, "utf8");
  if (token === undefined ||
      tokenBytes < E2E_CONTROL_MIN_TOKEN_BYTES ||
      tokenBytes > E2E_CONTROL_MAX_TOKEN_BYTES) {
    throw new Error("Playwright E2E control token is unavailable");
  }

  const response = await fetch(E2E_CONTROL_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [E2E_CONTROL_TOKEN_HEADER]: token,
    },
    body: JSON.stringify(request),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `E2E fixture control failed with HTTP ${response.status}: ${text.slice(0, 256)}`,
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("E2E fixture control returned invalid JSON");
  }
}

function assertAcknowledgement(value: unknown): asserts value is { ok: true } {
  if (!hasExactKeys(value, ["ok"]) || value.ok !== true) {
    throw new Error("E2E fixture control returned an invalid acknowledgement");
  }
}

function isPersistenceState(value: unknown): value is E2ePersistenceState {
  if (!hasExactKeys(value, [
    "backupStatus",
    "commitCount",
    "commitMessage",
    "contentPath",
    "extractionError",
    "extractionStatus",
    "fileContent",
    "gitStatus",
    "id",
    "title",
    "trackedContent",
    "url",
  ])) {
    return false;
  }

  return typeof value.commitCount === "number" &&
    Number.isSafeInteger(value.commitCount) &&
    value.commitCount >= 0 &&
    [
      value.backupStatus,
      value.commitMessage,
      value.contentPath,
      value.extractionError,
      value.extractionStatus,
      value.fileContent,
      value.gitStatus,
      value.id,
      value.title,
      value.trackedContent,
      value.url,
    ].every((field) => field === null || typeof field === "string");
}

function hasExactKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}
