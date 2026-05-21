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

  it("uses the configured target language when the request body is empty JSON", async () => {
    const handler = createStartTranslationHandler({
      startTranslationJob: async (input) => {
        expect(input.memoryId).toBe("019e3906-0000-7000-8000-000000000001");
        expect(input.langCode).toBeUndefined();
        return {
          status: "current",
          job_id: "job-1",
          lang_code: "ja-JP",
          memory_id: input.memoryId,
          output_path: "memories/019e3906-0000-7000-8000-000000000001/ja-JP/CONTENT.md",
          reader_url: "/memories/ja-JP/019e3906-0000-7000-8000-000000000001",
          source_hash: "sha256:source",
        };
      },
    });

    const response = await handler(
      createApiEvent({
        body: {},
        memoryId: "019e3906-0000-7000-8000-000000000001",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "current",
      lang_code: "ja-JP",
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
      action: "open_settings",
      code: "translation_language_mismatch",
      message: "Requested language does not match the configured translation target language.",
      status: "error",
    });
  });

  it.each([
    ["usage_limit", 409],
    ["context_overflow", 409],
    ["timeout", 504],
    ["stream_disconnected", 503],
    ["invalid_final_output", 502],
    ["validation_failed", 409],
    ["filesystem_failure", 500],
  ] as const)(
    "maps %s to the contracted HTTP status",
    async (code, expectedStatus) => {
      const handler = createStartTranslationHandler({
        startTranslationJob: async () => {
          throw new TranslationApiError(code, `${code} message`, "retry");
        },
      });

      const response = await handler(
        createApiEvent({
          body: { lang_code: "ja-JP" },
          memoryId: "019e3906-0000-7000-8000-000000000001",
        }),
      );

      expect(response.status).toBe(expectedStatus);
      await expect(response.json()).resolves.toMatchObject({
        action: "retry",
        code,
        message: `${code} message`,
        status: "error",
      });
    },
  );
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
