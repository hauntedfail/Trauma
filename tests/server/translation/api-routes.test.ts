import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import type { APIEvent } from "@solidjs/start/server";

import { createCancelTranslationHandler } from "../../../src/server/translation/cancel-translation-route";
import { createStartTranslationHandler } from "../../../src/server/translation/start-translation-route";
import { TranslationApiError } from "../../../src/server/translation/runner";
import type { TranslationJobStatus } from "../../../src/server/translation/types";

const startTranslationRouteSource = readFileSync(
  "src/routes/api/memories/[memoryId]/translations.ts",
  "utf8",
);

describe("translation API routes", () => {
  it("keeps the picked POST route as a thin framework entrypoint", () => {
    expect(startTranslationRouteSource).not.toContain(
      "function createStartTranslationHandler",
    );
  });

  it("starts translation from the memory route and returns the SSE event URL", async () => {
    const handler = createStartTranslationHandler({
      startTranslationJob: async (input) => {
        expect(input.memoryId).toBe("019e3906-0000-7000-8000-000000000001");
        expect(input.langCode).toBe("ja-JP");
        expect(input.model).toBe("gpt-5.5");
        expect(input.reasoningEffort).toBe("high");
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
        body: {
          lang_code: "ja-JP",
          model: "gpt-5.5",
          reasoning_effort: "high",
        },
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
    ["app_server_protocol_error", 502],
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

  it.each([
    ["translation_model_unavailable", 409],
    ["translation_reasoning_effort_unavailable", 409],
  ] as const)(
    "maps %s to a settings-correctable conflict",
    async (code, expectedStatus) => {
      const handler = createStartTranslationHandler({
        startTranslationJob: async () => {
          throw new TranslationApiError(code, `${code} message`, "open_settings");
        },
      });

      const response = await handler(
        createApiEvent({
          body: { lang_code: "ja-JP", model: "missing-model" },
          memoryId: "019e3906-0000-7000-8000-000000000001",
        }),
      );

      expect(response.status).toBe(expectedStatus);
      await expect(response.json()).resolves.toMatchObject({
        action: "open_settings",
        code,
        message: `${code} message`,
        status: "error",
      });
    },
  );

  it("rechecks job state when pending cancellation loses its CAS race", async () => {
    const events: string[] = [];
    const interrupted: string[] = [];
    const repo = createCancelRepo({
      job: {
        jobId: "job-race",
        langCode: "ja-JP",
        memoryId: "memory-race",
        status: "pending",
      },
      cancelPending: async (state) => {
        state.job = { ...state.job, status: "running" };
        return false;
      },
      requestRunning: async (state) => {
        state.job = { ...state.job, status: "cancel_requested" };
        return true;
      },
    });
    const handler = createCancelTranslationHandler({
      emitTranslationEvent: (event) => {
        events.push(event.type);
      },
      interruptRunningTranslationJobTurn: async (jobId) => {
        interrupted.push(jobId);
        return true;
      },
      openConnection: () => repo.connection,
    });

    const response = await handler(createCancelApiEvent("job-race"));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      status: "cancel_requested",
      job_id: "job-race",
    });
    expect(repo.calls).toEqual([
      "get:job-race",
      "cancel-pending:job-race",
      "get:job-race",
      "request-running:job-race",
    ]);
    expect(events).toEqual([]);
    expect(interrupted).toEqual(["job-race"]);
  });

  it("treats already canceled translation jobs as idempotent cancel success", async () => {
    const repo = createCancelRepo({
      job: {
        jobId: "job-canceled",
        langCode: "ja-JP",
        memoryId: "memory-canceled",
        status: "canceled",
      },
    });
    const handler = createCancelTranslationHandler({
      openConnection: () => repo.connection,
    });

    const response = await handler(createCancelApiEvent("job-canceled"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "canceled",
      job_id: "job-canceled",
    });
    expect(repo.calls).toEqual(["get:job-canceled"]);
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

function createCancelApiEvent(jobId: string): APIEvent {
  return {
    params: { jobId },
    request: new Request(`http://localhost/api/translation-jobs/${jobId}/cancel`, {
      method: "POST",
    }),
  } as unknown as APIEvent;
}

type CancelRepoJob = {
  jobId: string;
  langCode: string;
  memoryId: string;
  status: TranslationJobStatus;
};

function createCancelRepo(input: {
  cancelPending?: (state: { job: CancelRepoJob }) => Promise<boolean>;
  job: CancelRepoJob;
  requestRunning?: (state: { job: CancelRepoJob }) => Promise<boolean>;
}) {
  const state = { job: input.job };
  const calls: string[] = [];
  const repository = {
    getTranslationJob: async (jobId: string) => {
      calls.push(`get:${jobId}`);
      return state.job.jobId === jobId ? state.job : null;
    },
    cancelPendingTranslationJob: async (jobId: string) => {
      calls.push(`cancel-pending:${jobId}`);
      return input.cancelPending?.(state) ?? false;
    },
    requestRunningTranslationJobCancellation: async (jobId: string) => {
      calls.push(`request-running:${jobId}`);
      return input.requestRunning?.(state) ?? false;
    },
  };
  return {
    calls,
    connection: {
      close: () => undefined,
      repositories: {
        translations: repository,
      },
    },
  };
}
