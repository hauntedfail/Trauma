import { createHash } from "node:crypto";

export function createSha256ContentHash(
  input: string | ArrayBufferView,
): string {
  const hash = createHash("sha256");
  if (typeof input === "string") {
    hash.update(input, "utf8");
  } else {
    hash.update(Buffer.from(input.buffer, input.byteOffset, input.byteLength));
  }
  return `sha256:${hash.digest("hex")}`;
}

export function estimateRoughTokens(markdown: string): number {
  return Math.max(1, Math.ceil(markdown.length / 4));
}
