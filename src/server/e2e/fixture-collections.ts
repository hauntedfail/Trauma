import { initializeDatabase, schema } from "../db";
import {
  createReaderContentHash,
  readCanonicalReaderText,
} from "../store";
import { resetE2eFixture } from "./fixture-reset";
import {
  BROWSE_DELETE_MEMORY_ID,
  loadE2eConfig,
  PAGINATION_MEMORY_ID,
  readerMemoryRow,
  writeFixtureMemoryContent,
} from "./fixture-support";

const COLLECTION_ARCHIVE_SIZE = 37;

export async function materializeBrowseDeleteFixture(): Promise<void> {
  await resetE2eFixture("read_only");
  const config = loadE2eConfig();
  const now = new Date("2026-05-09T00:00:00.000Z");
  const markdown = "# Reader Mode Notes\n\nSearch query can be wired to flashback-aware results through repository fixtures.\n";
  const flashbackText = "flashback-aware results";
  const canonical = readCanonicalReaderText(markdown);
  const flashbackStartOffset = canonical.indexOf(flashbackText);
  const contentHash = createReaderContentHash(markdown);
  const connection = initializeDatabase(config);
  try {
    await connection.db.insert(schema.memories).values({
      ...readerMemoryRow(
        BROWSE_DELETE_MEMORY_ID,
        "Reader Mode Notes",
        "https://example.com/reader-mode",
        now,
      ),
      description: "Browse delete fixture",
    }).run();
    await connection.db.insert(schema.flashbacks).values({
      id: "h-foundation",
      memoryId: BROWSE_DELETE_MEMORY_ID,
      text: flashbackText,
      prefix: "Search query can be wired to",
      suffix: "through repository fixtures.",
      startOffset: flashbackStartOffset,
      endOffset: flashbackStartOffset + flashbackText.length,
      contentHash,
      createdAt: now,
      updatedAt: now,
    }).run();
    await connection.db.insert(schema.moments).values({
      id: "moment-foundation",
      memoryId: BROWSE_DELETE_MEMORY_ID,
      sectionAnchor: "details",
      sectionTitle: "Details",
      sectionLevel: 2,
      sectionPath: "1",
      createdAt: now,
      updatedAt: now,
    }).run();
  } finally {
    connection.close();
  }

  await writeFixtureMemoryContent(
    config,
    BROWSE_DELETE_MEMORY_ID,
    "Reader Mode Notes",
    "https://example.com/reader-mode",
    markdown,
  );
}

export async function materializeCollectionArchive(): Promise<void> {
  await resetE2eFixture("read_only");
  const config = loadE2eConfig();
  const pad = (value: number) => String(value).padStart(2, "0");
  const markdown = [
    "# Pagination Archive",
    ...Array.from({ length: COLLECTION_ARCHIVE_SIZE }, (_, index) => {
      const ordinal = index + 1;
      return [
        `## Moment Section ${pad(ordinal)}`,
        `Flashback selection ${pad(ordinal)} is stored here.`,
      ];
    }).flat(),
  ].join("\n\n");
  const baseTime = Date.parse("2026-07-17T00:00:00.000Z");
  const canonical = readCanonicalReaderText(markdown);
  const contentHash = createReaderContentHash(markdown);
  const connection = initializeDatabase(config);
  try {
    await connection.db.insert(schema.memories).values({
      ...readerMemoryRow(
        PAGINATION_MEMORY_ID,
        "Pagination Archive",
        "https://example.com/pagination-archive",
        new Date(baseTime),
      ),
      description: "Large collection pagination fixture",
    }).run();
    const flashbacks = [];
    const moments = [];
    for (let index = 0; index < COLLECTION_ARCHIVE_SIZE; index += 1) {
      const ordinal = index + 1;
      const suffix = pad(ordinal);
      const text = `Flashback selection ${suffix}`;
      const startOffset = canonical.indexOf(text);
      const createdAt = new Date(baseTime + ordinal);
      flashbacks.push({
        id: `flashback-page-${suffix}`,
        memoryId: PAGINATION_MEMORY_ID,
        text,
        prefix: "",
        suffix: " is stored here.",
        startOffset,
        endOffset: startOffset + text.length,
        contentHash,
        createdAt,
        updatedAt: createdAt,
      });
      moments.push({
        id: `moment-page-${suffix}`,
        memoryId: PAGINATION_MEMORY_ID,
        sectionAnchor: `moment-section-${suffix}`,
        sectionTitle: `Moment Section ${suffix}`,
        sectionLevel: 2,
        sectionPath: `1/${ordinal}`,
        sectionStartOffset: null,
        sectionEndOffset: null,
        contentHash,
        createdAt,
        updatedAt: createdAt,
      });
    }
    await connection.db.insert(schema.flashbacks).values(flashbacks).run();
    await connection.db.insert(schema.moments).values(moments).run();
  } finally {
    connection.close();
  }

  await writeFixtureMemoryContent(
    config,
    PAGINATION_MEMORY_ID,
    "Pagination Archive",
    "https://example.com/pagination-archive",
    markdown,
    new Date(baseTime).toISOString(),
  );
}
