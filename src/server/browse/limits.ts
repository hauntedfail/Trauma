export const MAX_BROWSE_RESULT_LIMIT = 100;

export function normalizeBrowseLimit(limit: number): number {
  const normalized = Math.trunc(limit);
  if (!Number.isFinite(normalized) || normalized < 1) {
    return 1;
  }

  return Math.min(normalized, MAX_BROWSE_RESULT_LIMIT);
}
