import { describe, expect, it } from "vitest";

import { parseHighlightTogglePayload } from "../../../src/routes/api/highlights";

describe("highlights API route", () => {
  it("validates and preserves a reader selection payload", async () => {
    const result = await parseHighlightTogglePayload(
      new Request("http://localhost/api/highlights", {
        method: "POST",
        body: JSON.stringify({
          memoryId: " 018f04a2-3c6f-7c88-9a8b-8c99a9b7f301 ",
          operation: "highlight",
          selection: {
            text: "target",
            prefix: "Beta ",
            suffix: " appears",
            startOffset: 53,
            endOffset: 59,
          },
        }),
      }),
    );

    expect(result).toEqual({
      ok: true,
      memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f301",
      operation: "highlight",
      selection: {
        text: "target",
        prefix: "Beta ",
        suffix: " appears",
        startOffset: 53,
        endOffset: 59,
      },
    });
  });

  it("rejects malformed or over-posted selection payloads", async () => {
    await expectPayloadError(
      {
        memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f301",
        operation: "highlight",
        selection: {
          text: "target",
          prefix: "",
          suffix: "",
          startOffset: 53,
          endOffset: 53,
          extra: true,
        },
      },
      "selection must contain only text, prefix, suffix, startOffset, and endOffset",
    );
  });
});

async function expectPayloadError(payload: unknown, error: string): Promise<void> {
  await expect(
    parseHighlightTogglePayload(
      new Request("http://localhost/api/highlights", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    ),
  ).resolves.toEqual({ ok: false, error });
}
