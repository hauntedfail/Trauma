import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createMomentForSection } from "../../src/components/reader/moment-requests";

const readerSource = readFileSync("src/components/reader/MemoryReader.tsx", "utf8");
const styleSource = readFileSync("src/styles/tailwind.css", "utf8");

describe("reader Moment actions", () => {
  it("uses one contextual menu component for text selection and section Moment actions", () => {
    expect(readerSource).toContain("function ReaderContextMenu");
    expect(readerSource).toContain('aria-label="Flashback selection"');
    expect(readerSource).toContain('aria-label="Moment section"');
    expect(readerSource).toContain("ReaderSectionMenuState");
  });

  it("renders Moment affordances for ToC rows and reader headings without shifting text on hover", () => {
    expect(readerSource).toContain("ReaderTocEntryRow");
    expect(readerSource).toContain("Moment ${props.entry.text}");
    expect(readerSource).toContain("onOpenSectionMenu");
    expect(readerSource).toContain("onPointerDown");
    expect(readerSource).toContain("data-reader-section-anchor");
    expect(readerSource).toContain("button[data-reader-moment-trigger='true']");
    expect(styleSource).toContain(".trauma-reader-section-moment");
    expect(styleSource).toContain("position: absolute");
    expect(styleSource).toContain("opacity: 0");
  });

  it("surfaces Moment API error bodies for debugging client failures", async () => {
    await expect(
      createMomentForSection({
        memoryId: "memory-1",
        section: {
          id: "chapter-one",
          level: 2,
          path: "1/1",
          text: "Chapter One",
        },
        fetch: async () =>
          new Response(
            JSON.stringify({
              error: "moment section identity does not match reader content",
            }),
            {
              status: 400,
              headers: { "content-type": "application/json" },
            },
          ),
      }),
    ).rejects.toThrow("moment section identity does not match reader content");
  });

  it("posts section identity to the Moment API", async () => {
    const requests: Request[] = [];
    const result = await createMomentForSection({
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
            moment: {
              id: "moment-1",
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

    expect(result.moment.sectionAnchor).toBe("chapter-one");
    expect(requests[0]?.url).toBe("http://localhost/api/moments");
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

  it("revalidates both Moment browse and reader memory caches after creating a Moment", () => {
    expect(readerSource).toContain(
      [
        "void Promise.all([",
        "        revalidateMomentBrowseRows(),",
        "        revalidateReaderMemory(props.result.memory.id),",
        "      ]);",
      ].join("\n"),
    );
  });
});
