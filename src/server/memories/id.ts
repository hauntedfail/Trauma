import { randomBytes } from "node:crypto";

const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isMemoryId(value: string): boolean {
  return UUID_V7_PATTERN.test(value);
}

export function assertMemoryId(value: string): void {
  if (!isMemoryId(value)) {
    throw new Error("memory id must be a UUID v7");
  }
}

export function generateMemoryId(now = new Date()): string {
  const timestamp = BigInt(now.getTime());
  const timeHex = timestamp.toString(16).padStart(12, "0").slice(-12);
  const random = randomBytes(10);
  const randA = (((random[0] ?? 0) << 8) | (random[1] ?? 0)) & 0x0fff;
  const randB = ((random[2] ?? 0) & 0x3f) | 0x80;

  return [
    timeHex.slice(0, 8),
    timeHex.slice(8, 12),
    `7${randA.toString(16).padStart(3, "0")}`,
    `${randB.toString(16).padStart(2, "0")}${toHex(random[3] ?? 0)}`,
    Array.from(random.slice(4, 10), toHex).join(""),
  ].join("-");
}

function toHex(value: number) {
  return value.toString(16).padStart(2, "0");
}
