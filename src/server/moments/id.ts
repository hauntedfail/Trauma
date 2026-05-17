import { randomUUID } from "node:crypto";

export function generateMomentId(): string {
  return randomUUID();
}
