import type { APIEvent } from "@solidjs/start/server";

import { loadRuntimeTraumaConfig } from "../config";
import { initializeDatabase, type TraumaDatabaseConnection } from "../db";
import type { TranslationJobRecord } from "../db/repositories";
import { formatConfigError, jsonResponse } from "../http/json";
import {
  type EmitTranslationEventInput,
  translationEventBus,
} from "./events";
import { interruptRunningTranslationJobTurn } from "./runner";

type CancelableTranslationJob = Pick<
  TranslationJobRecord,
  "jobId" | "langCode" | "memoryId" | "status"
>;

interface CancelTranslationRepository {
  cancelPendingTranslationJob: (jobId: string, updatedAt: Date) => Promise<boolean>;
  getTranslationJob: (jobId: string) => Promise<CancelableTranslationJob | null>;
  requestRunningTranslationJobCancellation: (
    jobId: string,
    updatedAt: Date,
  ) => Promise<boolean>;
}

type CancelTranslationConnection = Pick<TraumaDatabaseConnection, "close"> & {
  repositories: {
    translations: CancelTranslationRepository;
  };
};

type EmitTranslationEvent = <TData>(
  input: EmitTranslationEventInput<TData>,
) => unknown;

export function createCancelTranslationHandler(input: {
  emitTranslationEvent?: EmitTranslationEvent;
  interruptRunningTranslationJobTurn?: (jobId: string) => Promise<boolean>;
  openConnection?: () => CancelTranslationConnection;
} = {}) {
  return async function handleCancelTranslation(event: APIEvent): Promise<Response> {
    return handleCancelTranslationRequest(event, input);
  };
}

export async function handleCancelTranslationRequest(
  event: APIEvent,
  input: {
    emitTranslationEvent?: EmitTranslationEvent;
    interruptRunningTranslationJobTurn?: (jobId: string) => Promise<boolean>;
    openConnection?: () => CancelTranslationConnection;
  } = {},
): Promise<Response> {
  const jobId = event.params.jobId?.trim();
  if (jobId === undefined || jobId === "") {
    return jsonResponse(
      { error: "jobId must be a non-empty string" },
      { status: 400 },
    );
  }

  try {
    const connection = input.openConnection === undefined
      ? createDefaultCancelConnection()
      : input.openConnection();
    try {
      const job = await connection.repositories.translations.getTranslationJob(jobId);
      if (job === null) {
        return jsonResponse(
          { error: "translation job was not found" },
          { status: 404 },
        );
      }
      return cancelTranslationJobRecord({
        emitTranslationEvent: input.emitTranslationEvent ??
          translationEventBus.emit.bind(translationEventBus),
        interruptRunningTranslationJobTurn: input.interruptRunningTranslationJobTurn ??
          interruptRunningTranslationJobTurn,
        job,
        repository: connection.repositories.translations,
        retryOnCasMiss: true,
      });
    } finally {
      connection.close();
    }
  } catch (error) {
    return jsonResponse({ error: formatConfigError(error) }, { status: 500 });
  }
}

async function cancelTranslationJobRecord(input: {
  emitTranslationEvent: EmitTranslationEvent;
  interruptRunningTranslationJobTurn: (jobId: string) => Promise<boolean>;
  job: CancelableTranslationJob;
  repository: CancelTranslationRepository;
  retryOnCasMiss: boolean;
}): Promise<Response> {
  if (input.job.status === "pending") {
    const canceled = await input.repository.cancelPendingTranslationJob(
      input.job.jobId,
      new Date(),
    );
    if (canceled) {
      input.emitTranslationEvent({
        data: {},
        jobId: input.job.jobId,
        langCode: input.job.langCode,
        memoryId: input.job.memoryId,
        type: "translation.job.canceled",
      });
      return jsonResponse(
        { status: "canceled", job_id: input.job.jobId },
        { status: 200 },
      );
    }
    return retryCancelAfterCasMiss(input);
  }

  if (input.job.status === "running") {
    const requested = await input.repository.requestRunningTranslationJobCancellation(
      input.job.jobId,
      new Date(),
    );
    if (requested) {
      await input.interruptRunningTranslationJobTurn(input.job.jobId)
        .catch(() => false);
      return jsonResponse(
        { status: "cancel_requested", job_id: input.job.jobId },
        { status: 202 },
      );
    }
    return retryCancelAfterCasMiss(input);
  }

  if (input.job.status === "cancel_requested") {
    return jsonResponse(
      { status: "cancel_requested", job_id: input.job.jobId },
      { status: 202 },
    );
  }

  if (input.job.status === "canceled") {
    return jsonResponse(
      { status: "canceled", job_id: input.job.jobId },
      { status: 200 },
    );
  }

  return cancellationConflict(input.job);
}

async function retryCancelAfterCasMiss(input: {
  emitTranslationEvent: EmitTranslationEvent;
  interruptRunningTranslationJobTurn: (jobId: string) => Promise<boolean>;
  job: CancelableTranslationJob;
  repository: CancelTranslationRepository;
  retryOnCasMiss: boolean;
}): Promise<Response> {
  if (!input.retryOnCasMiss) {
    return cancellationConflict(input.job);
  }
  const refreshed = await input.repository.getTranslationJob(input.job.jobId);
  if (refreshed === null) {
    return jsonResponse(
      { error: "translation job was not found" },
      { status: 404 },
    );
  }
  if (refreshed.status === input.job.status) {
    return cancellationConflict(refreshed);
  }
  return cancelTranslationJobRecord({
    emitTranslationEvent: input.emitTranslationEvent,
    interruptRunningTranslationJobTurn: input.interruptRunningTranslationJobTurn,
    job: refreshed,
    repository: input.repository,
    retryOnCasMiss: false,
  });
}

function cancellationConflict(job: CancelableTranslationJob): Response {
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
}

function createDefaultCancelConnection(): CancelTranslationConnection {
  return initializeDatabase(loadRuntimeTraumaConfig());
}
