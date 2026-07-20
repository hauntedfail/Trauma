export const CODEX_SERIALIZED_EVENT_MAX_BYTES = 64 * 1_024;

export function measureSerializedCodexEventBytes(event: unknown): number {
  const serialized = JSON.stringify(event);
  if (serialized === undefined) {
    throw new TypeError("Codex event must be JSON serializable.");
  }
  return Buffer.byteLength(serialized, "utf8");
}
