import type { APIEvent } from "@solidjs/start/server";

import { loadRuntimeTraumaConfig } from "~/server/config";
import { initializeDatabase } from "~/server/db";
import { formatConfigError, jsonResponse } from "~/server/http/json";
import { translationEventBus } from "~/server/translation/events";

export async function POST(event: APIEvent): Promise<Response> {
  const jobId = event.params.jobId?.trim();
  if (jobId === undefined || jobId === "") {
    return jsonResponse(
      { error: "jobId must be a non-empty string" },
      { status: 400 },
    );
  }

  try {
    const config = loadRuntimeTraumaConfig();
    const connection = initializeDatabase(config);
    try {
      const job = await connection.repositories.translations.getTranslationJob(jobId);
      if (job === null) {
        return jsonResponse(
          { error: "translation job was not found" },
          { status: 404 },
        );
      }
      if (job.status === "pending") {
        const canceled = await connection.repositories.translations
          .cancelPendingTranslationJob(jobId, new Date());
        if (canceled) {
          translationEventBus.emit({
            data: {},
            jobId,
            langCode: job.langCode,
            memoryId: job.memoryId,
            type: "translation.job.canceled",
          });
        }
        return jsonResponse({ status: "canceled", job_id: jobId }, { status: 200 });
      }
      if (job.status === "running") {
        await connection.repositories.translations
          .requestRunningTranslationJobCancellation(jobId, new Date());
        return jsonResponse(
          { status: "cancel_requested", job_id: jobId },
          { status: 202 },
        );
      }
      if (job.status === "cancel_requested") {
        return jsonResponse(
          { status: "cancel_requested", job_id: jobId },
          { status: 202 },
        );
      }

      return jsonResponse(
        {
          error: {
            action: "none",
            code: "cancellation_conflict",
            message: `Cannot cancel a ${job.status} translation job.`,
          },
        },
        { status: 409 },
      );
    } finally {
      connection.close();
    }
  } catch (error) {
    return jsonResponse({ error: formatConfigError(error) }, { status: 500 });
  }
}
