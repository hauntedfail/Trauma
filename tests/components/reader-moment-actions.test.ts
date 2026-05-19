import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  findReaderMomentForSection,
  findFlashbackForOptimisticSelection,
  findLeadingReaderTitleEntry,
  readLeadingReaderHeadingAnchor,
  resolveReaderMomentTarget,
  splitLeadingReaderTitleContent,
} from "../../src/components/reader/MemoryReader";
import {
  createMomentForSection,
} from "../../src/components/reader/moment-requests";
import { deleteMomentById } from "../../src/components/moments/moment-action-requests";

const readerSource = readFileSync("src/components/reader/MemoryReader.tsx", "utf8");
const styleSource = readFileSync("src/styles/tailwind.css", "utf8");

describe("reader Moment actions", () => {
  it("uses one contextual menu component for text selection and section Moment actions", () => {
    expect(readerSource).toContain("function ReaderContextMenu");
    expect(readerSource).toContain('aria-label="Flashback selection"');
    expect(readerSource).toContain('aria-label="Moment section"');
    expect(readerSource).toContain("ReaderSectionMenuState");
    expect(readerSource).toContain("readerContextMenuClass");
    expect(readerSource).toContain("border border-transparent bg-transparent");
    expect(readerSource).toContain("opacity-50");
    expect(readerSource).toContain("shadow-none");
    expect(readerSource).not.toContain("border border-trauma-border bg-trauma-bg-elev p-1 shadow-trauma-2");
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

  it("keeps leading title headings in reader content so marks, Moment controls, and offsets stay canonical", () => {
    expect(readerSource).not.toContain("stripLeadingReaderTitleHeading");
    expect(styleSource).not.toContain("data-reader-leading-title");
    expect(readLeadingReaderHeadingAnchor(
      '  <h1 data-reader-section-anchor="reader-title">Reader title</h1><p>Body</p>',
    )).toBe("reader-title");
    expect(readLeadingReaderHeadingAnchor(
      '<p>Intro</p><h1 data-reader-section-anchor="reader-title">Reader title</h1>',
    )).toBeUndefined();
    expect(
      findLeadingReaderTitleEntry({
        html: '<h1 data-reader-section-anchor="reader-title">Reader title</h1>',
        title: "Reader title",
        toc: [{ id: "reader-title", level: 1, path: "1", text: "Reader title" }],
      }),
    ).toEqual({ id: "reader-title", level: 1, path: "1", text: "Reader title" });
    expect(
      splitLeadingReaderTitleContent({
        html: '<h1 data-reader-section-anchor="reader-title"><mark data-flashback-id="title-flashback">Reader title</mark></h1><p>Body</p>',
        title: "Reader title",
        toc: [{ id: "reader-title", level: 1, path: "1", text: "Reader title" }],
      }),
    ).toEqual({
      bodyHtml: "<p>Body</p>",
      titleHtml:
        '<h1 data-reader-section-anchor="reader-title"><mark data-flashback-id="title-flashback">Reader title</mark></h1>',
    });
  });

  it("keeps taxonomy chips out of reader selection ranges", () => {
    expect(readerSource).toContain("data-reader-noncontent");
    expect(readerSource).toContain("rangeIntersectsReaderNonContent");
    expect(readerSource).toContain("querySelectorAll(\"[data-reader-noncontent]\")");
    expect(readerSource).toContain("compareBoundaryPoints");
  });

  it("keeps lifted reader chrome out of selection offsets and body rollback", () => {
    expect(readerSource).toContain("let bodyContentRef: HTMLDivElement | undefined");
    expect(readerSource).toContain("container: bodyContentRef");
    expect(readerSource).toContain("data-reader-mutable-content");
    expect(readerSource).toContain("ref={bodyContentRef}");
    expect(readerSource).toContain("data-reader-noncontent");
    expect(readerSource).toContain("class=\"trauma-reader-lifted-title\"");
    expect(readerSource).toContain("innerHTML={readerBodyHtml()}");
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
        "await Promise.all([",
        "        revalidateMomentBrowseRows(),",
        "        revalidateReaderMemory(props.result.memory.id),",
        "      ]);",
      ].join("\n"),
    );
  });

  it("does not mark a reused Moment anchor active when the saved path moved", () => {
    expect(
      resolveReaderMomentTarget(
        {
          id: "moment-1",
          sectionAnchor: "chapter-one",
          sectionTitle: "Chapter One",
          sectionLevel: 2,
          sectionPath: "1/2",
          sectionStartOffset: null,
          sectionEndOffset: null,
          contentHash: null,
          createdAt: "2026-05-14T00:00:00.000Z",
        },
        [
          {
            id: "chapter-one",
            level: 2,
            path: "1/1",
            text: "Chapter One",
          },
          {
            id: "renamed-original-section",
            level: 2,
            path: "1/2",
            text: "Renamed Original Section",
          },
        ],
      ),
    ).toMatchObject({
      id: "renamed-original-section",
      path: "1/2",
    });
  });

  it("maps optimistic Flashback marks to the server-saved range id", () => {
    expect(
      findFlashbackForOptimisticSelection(
        [
          {
            id: "flashback-1",
            text: "saved selection",
            prefix: "",
            suffix: "",
            startOffset: 8,
            endOffset: 23,
            contentHash: "sha256:test",
            createdAt: "2026-05-14T00:00:00.000Z",
          },
        ],
        {
          text: "saved selection",
          prefix: "",
          suffix: "",
          startOffset: 8,
          endOffset: 23,
        },
      )?.id,
    ).toBe("flashback-1");
  });

  it("finds the active Moment for a reader section by the current ToC identity", () => {
    expect(
      findReaderMomentForSection(
        [
          {
            id: "moment-1",
            sectionAnchor: "old-details",
            sectionTitle: "Details",
            sectionLevel: 2,
            sectionPath: "1/1",
            sectionStartOffset: null,
            sectionEndOffset: null,
            contentHash: null,
            createdAt: "2026-05-14T00:00:00.000Z",
          },
        ],
        [
          {
            id: "details",
            level: 2,
            path: "1/1",
            text: "Details",
          },
        ],
        {
          id: "details",
          level: 2,
          path: "1/1",
          text: "Details",
        },
      )?.id,
    ).toBe("moment-1");
  });

  it("deletes Moments through the public Moment API", async () => {
    const requests: Request[] = [];

    await deleteMomentById({
      momentId: "moment-1",
      fetch: async (input, init) => {
        requests.push(new Request(new URL(String(input), "http://localhost"), init));
        return new Response(null, { status: 204 });
      },
    });

    expect(requests[0]?.url).toBe("http://localhost/api/moments/moment-1");
    expect(requests[0]?.method).toBe("DELETE");
  });
});
