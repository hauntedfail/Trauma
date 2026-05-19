export function buildMemoryHref(memoryId: string): string {
  return `/memories/${encodeURIComponent(memoryId)}`;
}

export function buildMemoryAnchorHref(input: {
  anchorId?: null | string;
  memoryId: string;
}): string {
  const anchorId = input.anchorId?.trim() ?? "";
  if (anchorId.length === 0) {
    return buildMemoryHref(input.memoryId);
  }

  return `${buildMemoryHref(input.memoryId)}${buildSameMemoryAnchorHref(anchorId)}`;
}

export function buildSameMemoryAnchorHref(anchorId: string): string {
  return `#${encodeURIComponent(anchorId)}`;
}
