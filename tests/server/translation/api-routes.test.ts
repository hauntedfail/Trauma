import { describe, expect, it } from "vitest";
import type { APIEvent } from "@solidjs/start/server";

import { createStartTranslationHandler } from "../../../src/routes/api/memories/[memoryId]/translations";
import { TranslationApiError } from "../../../src/server/translation/runner";

describe("translation API routes", () => {
  it("starts translation from the memory route and returns the SSE event URL", async () => {
    const handler = createStartTranslationHandler({
      startTranslationJob: async (input) => {
        expect(input.memoryId).toBe("019e3906-0000-7000-8000-000000000001");
        expect(input.langCode).toBe("ja-JP");
        return {
          status: "started",
          event_url: "/api/translation-jobs/job-1/events",
          job_id: "job-1",
          lang_code: "ja-JP",
          memory_id: input.memoryId,
          source_hash: "sha256:source",
        };
      },
    });

    const response = await handler(
      createApiEvent({
        body: { lang_code: "ja-JP" },
        memoryId: "019e3906-0000-7000-8000-000000000001",
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      status: "started",
      event_url: "/api/translation-jobs/job-1/events",
      job_id: "job-1",
      lang_code: "ja-JP",
      memory_id: "019e3906-0000-7000-8000-000000000001",
      source_hash: "sha256:source",
    });
  });

  it("maps translation boundary errors to safe JSON responses", async () => {
    const handler = createStartTranslationHandler({
      startTranslationJob: async () => {
        throw new TranslationApiError(
          "translation_language_mismatch",
          "Requested language does not match the configured translation target language.",
          "open_settings",
        );
      },
    });

    const response = await handler(
      createApiEvent({
        body: { lang_code: "en-US" },
        memoryId: "019e3906-0000-7000-8000-000000000001",
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        action: "open_settings",
        code: "translation_language_mismatch",
        message: "Requested language does not match the configured translation target language.",
      },
    });
  });
});

function createApiEvent(input: {
  body: unknown;
  memoryId: string;
}): APIEvent {
  return {
    params: {
      memoryId: input.memoryId,
    },
    request: new Request("http://localhost/api/memories/test/translations", {
      body: JSON.stringify(input.body),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  } as unknown as APIEvent;
}
