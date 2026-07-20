export type CollectionPageState<Page> =
  | { cursor: string | null; page: Page; status: "ready" }
  | { cursor: string | null; status: "error" };

export function readCollectionPageCursor(search: string): string | null {
  const cursor = new URLSearchParams(search).get("cursor");
  return cursor === null || cursor.length === 0 ? null : cursor;
}

export function buildCollectionPageHref(
  pathname: string,
  cursor: string | null,
): string {
  if (cursor === null) {
    return pathname;
  }
  const params = new URLSearchParams({ cursor });
  return `${pathname}?${params.toString()}`;
}

export async function settleCollectionPage<Page>(
  cursor: string | null,
  load: () => Promise<Page>,
): Promise<CollectionPageState<Page>> {
  try {
    return { cursor, page: await load(), status: "ready" };
  } catch {
    return { cursor, status: "error" };
  }
}
