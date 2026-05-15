import { randomUUID } from "node:crypto";

export function generateFlashbackId(): string {
  return randomUUID();
}
