import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createFlashbackForSection } from "../../src/components/reader/flashback-requests";

const readerSource = readFileSync("src/components/reader/MemoryReader.tsx", "utf8");
const styleSource = readFileSync("src/styles/tailwind.css", "utf8");

describe("reader Flashback actions", () => {
  it("uses one contextual menu component for text selection and section Flashback actions", () => {
    expect(readerSource).toContain("function ReaderContextMenu");
    expect(readerSource).toContain('aria-label="Highlight selection"');
    expect(readerSource).toContain('aria-label="Flashback section"');
    expect(readerSource).toContain("ReaderSectionMenuState");
  });

  it("renders Flashback affordances for ToC rows and reader headings without shifting text on hover", () => {
    expect(readerSource).toContain("ReaderTocEntryRow");
    expect(readerSource).toContain("Flashback ${props.entry.text}");
    expect(readerSource).toContain("onOpenSectionMenu");
    expect(readerSource).toContain("onPointerDown");
    expect(readerSource).toContain("data-reader-section-anchor");
    expect(styleSource).toContain(
      ".trauma-reader-content [data-reader-section-anchor]::before",
    );
    expect(styleSource).toContain("position: absolute");
    expect(styleSource).toContain("opacity: 0");
  });

  it("posts section identity to the Flashback API", async () => {
    const requests: Request[] = [];
    const result = await createFlashbackForSection({
      memoryId: "memory-1",
      section: {
        id: "chapter-one",
        level: 2,
        path: "1/1",
        text: "Chapter One",
      },
      fetch: async (input, init) => {
        requests.push(new Request(new URL(String(input), "http://localhost"), init));
        return new Response(
          JSON.stringify({
            alreadyExists: false,
            flashback: {
              id: "flashback-1",
              sectionAnchor: "chapter-one",
              sectionTitle: "Chapter One",
              sectionLevel: 2,
              sectionPath: "1/1",
              sectionStartOffset: null,
              sectionEndOffset: null,
              contentHash: null,
              createdAt: "2026-05-14T00:00:00.000Z",
            },
          }),
          {
            status: 201,
            headers: { "content-type": "application/json" },
          },
        );
      },
    });

    expect(result.flashback.sectionAnchor).toBe("chapter-one");
    expect(requests[0]?.url).toBe("http://localhost/api/flashbacks");
    expect(requests[0]?.method).toBe("POST");
    await expect(requests[0]?.json()).resolves.toEqual({
      memoryId: "memory-1",
      sectionAnchor: "chapter-one",
      sectionTitle: "Chapter One",
      sectionLevel: 2,
      sectionPath: "1/1",
      sectionStartOffset: null,
      sectionEndOffset: null,
      contentHash: null,
    });
  });
});
