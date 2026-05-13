export type AddMemorySubmitResult =
  | {
      ok: true;
      memoryId: string;
    }
  | {
      ok: false;
      error: string;
      backupFailsafe?: boolean;
    };

export interface SubmitAddMemoryUrlInput {
  url: string;
  fetch?: AddMemoryFetch;
}

export type AddMemoryFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

const DEFAULT_SUBMISSION_ERROR =
  "Failed to save memory. Check the URL and try again.";
const MISSING_MEMORY_ID_ERROR =
  "Memory was created but the response did not include an id.";

export async function submitAddMemoryUrl(
  input: SubmitAddMemoryUrlInput,
): Promise<AddMemorySubmitResult> {
  const url = input.url.trim();
  if (url === "") {
    return {
      ok: false,
      error: "Enter a URL before saving.",
    };
  }

  let response: Response;
  try {
    response = await (input.fetch ?? fetchAddMemory)("/api/memories", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ url }),
    });
  } catch {
    return {
      ok: false,
      error: DEFAULT_SUBMISSION_ERROR,
    };
  }

  const payload = await readJsonRecord(response);
  if (!response.ok) {
    const isBackupFailsafe = hasBackupFailsafe(payload);
    return {
      ok: false,
      error: readErrorMessage(payload) ?? DEFAULT_SUBMISSION_ERROR,
      ...(isBackupFailsafe ? { backupFailsafe: true } : {}),
    };
  }

  const memoryId = readCreatedMemoryId(payload);
  if (memoryId === null) {
    return {
      ok: false,
      error: MISSING_MEMORY_ID_ERROR,
    };
  }

  return {
    ok: true,
    memoryId,
  };
}

const fetchAddMemory: AddMemoryFetch = (input, init) => fetch(input, init);

async function readJsonRecord(
  response: Response,
): Promise<Record<string, unknown> | null> {
  try {
    const payload: unknown = await response.json();
    return isRecord(payload) ? payload : null;
  } catch {
    return null;
  }
}

function readErrorMessage(payload: Record<string, unknown> | null) {
  const error = payload?.error;
  return typeof error === "string" && error.trim() !== "" ? error : null;
}

function readCreatedMemoryId(payload: Record<string, unknown> | null) {
  const memory = payload?.memory;
  if (!isRecord(memory)) {
    return null;
  }

  const id = memory.id;
  return typeof id === "string" && id.trim() !== "" ? id : null;
}

function hasBackupFailsafe(payload: Record<string, unknown> | null) {
  return isRecord(payload?.backupFailsafe);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
