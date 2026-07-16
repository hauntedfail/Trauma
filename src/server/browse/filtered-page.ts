export interface CursorPage<Row, Cursor> {
  rows: Row[];
  nextCursor: Cursor | null;
}

export async function collectFilteredCursorPage<Row, Cursor>(input: {
  cursor: Cursor | null;
  filterRows: (rows: Row[]) => Promise<Row[]>;
  limit: number;
  loadPage: (input: {
    cursor: Cursor | null;
    limit: number;
  }) => Promise<CursorPage<Row, Cursor>>;
  maxFetchRounds: number;
}): Promise<CursorPage<Row, Cursor>> {
  const rows: Row[] = [];
  let cursor = input.cursor;
  let nextCursor: Cursor | null = null;
  let rounds = 0;

  while (rows.length < input.limit) {
    rounds += 1;
    const page = await input.loadPage({
      cursor,
      limit: input.limit - rows.length,
    });

    if (page.rows.length === 0) {
      nextCursor = null;
      break;
    }

    rows.push(...(await input.filterRows(page.rows)));
    nextCursor = page.nextCursor;
    if (
      rows.length >= input.limit ||
      page.nextCursor === null ||
      rounds >= input.maxFetchRounds
    ) {
      break;
    }

    cursor = page.nextCursor;
  }

  return { rows, nextCursor };
}
