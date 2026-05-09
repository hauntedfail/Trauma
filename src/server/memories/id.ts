import { randomBytes } from "node:crypto";

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
