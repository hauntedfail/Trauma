export interface FlashbackFailure {
  backupFailsafe: boolean;
  message: string;
}

export async function readFlashbackFailure(
  response: Response,
): Promise<FlashbackFailure | undefined> {
  if (response.ok) {
    return undefined;
  }

  const payload = await readJsonRecord(response);
  return {
    backupFailsafe: isRecord(payload?.backupFailsafe),
    message: "Flashback failed",
  };
}

export function shouldRevalidateBackupFailsafeAfterFlashbackFailure(
  failure: FlashbackFailure | undefined,
) {
  return failure?.backupFailsafe === true;
}

async function readJsonRecord(response: Response) {
  try {
    const payload: unknown = await response.json();
    return isRecord(payload) ? payload : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
