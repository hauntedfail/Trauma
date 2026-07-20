import { initializeDatabase, schema } from "../db";
import { resetE2eFixture } from "./fixture-reset";
import {
  loadE2eConfig,
  READER_MEMORY_ID,
  readerMemoryRow,
  SECOND_READER_MEMORY_ID,
  TOC_SCROLL_MEMORY_ID,
  writeFixtureMemoryContent,
} from "./fixture-support";

export async function materializeReaderFixture(): Promise<void> {
  await resetE2eFixture("read_only");
  const config = loadE2eConfig();
  const readerMarkdown = [
    "# Fixture Reader",
    "",
    "Curated markdown body with saved flashback.",
    "",
    "A [Reference link](https://example.com/reference) belongs to the reader content.",
    "",
    ...Array.from({ length: 16 }, (_, index) => [
      `Reader spacer paragraph ${index + 1} keeps lower anchors below the first viewport.`,
      "",
    ]).flat(),
    "## Details",
    "",
    "Details section keeps deep saved flashback in the lower reader body.",
    "",
    "| Kind | Value |",
    "| --- | --- |",
    "| reader | smoke |",
    "",
    ...Array.from({ length: 16 }, (_, index) => [
      `Reader trailing paragraph ${index + 1} keeps anchored sections scrollable to the top.`,
      "",
    ]).flat(),
  ].join("\n");
  const now = new Date("2026-05-09T00:00:00.000Z");
  const connection = initializeDatabase(config);
  try {
    await connection.db.insert(schema.memories).values([
      readerMemoryRow(READER_MEMORY_ID, "Fixture Reader", "https://example.com/reader", now),
      readerMemoryRow(
        SECOND_READER_MEMORY_ID,
        "Second Fixture Reader",
        "https://example.com/second-reader",
        now,
      ),
      readerMemoryRow(
        TOC_SCROLL_MEMORY_ID,
        "Long Contents Fixture",
        "https://example.com/long-contents",
        now,
      ),
    ]).run();
    const flashbackStartOffset = readerMarkdown.indexOf("saved flashback");
    const deepFlashbackStartOffset = readerMarkdown.indexOf("deep saved flashback");
    await connection.db.insert(schema.flashbacks).values([
      {
        id: "flashback-fixture",
        memoryId: READER_MEMORY_ID,
        text: "saved flashback",
        prefix: "Curated markdown body with ",
        suffix: ".",
        startOffset: flashbackStartOffset,
        endOffset: flashbackStartOffset + "saved flashback".length,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "flashback-deep",
        memoryId: READER_MEMORY_ID,
        text: "deep saved flashback",
        prefix: "Details section keeps ",
        suffix: " in the lower reader body.",
        startOffset: deepFlashbackStartOffset,
        endOffset: deepFlashbackStartOffset + "deep saved flashback".length,
        createdAt: new Date("2026-05-09T00:01:00.000Z"),
        updatedAt: new Date("2026-05-09T00:01:00.000Z"),
      },
    ]).run();
  } finally {
    connection.close();
  }

  await Promise.all([
    writeFixtureMemoryContent(
      config,
      READER_MEMORY_ID,
      "Fixture Reader",
      "https://example.com/reader",
      readerMarkdown,
    ),
    writeFixtureMemoryContent(
      config,
      SECOND_READER_MEMORY_ID,
      "Second Fixture Reader",
      "https://example.com/second-reader",
      [
        "# Second Fixture Reader",
        "",
        "Second reader body.",
        "",
        "## Follow Up",
        "",
        "Ready-to-ready navigation should replace the rendered article.",
      ].join("\n"),
    ),
    writeFixtureMemoryContent(
      config,
      TOC_SCROLL_MEMORY_ID,
      "Long Contents Fixture",
      "https://example.com/long-contents",
      [
        "# Long Contents Fixture",
        "",
        "This reader exists to make the right-rail table of contents overflow.",
        "",
        ...Array.from({ length: 48 }, (_, index) => [
          `## Section ${index + 1}`,
          "",
          `Body ${index + 1}.`,
        ]).flat(),
      ].join("\n"),
    ),
  ]);
}
