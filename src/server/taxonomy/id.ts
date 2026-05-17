import { randomUUID } from "node:crypto";

export function generateTaxonomyId(): string {
  return randomUUID();
}
