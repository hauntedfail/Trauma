import type { APIEvent } from "@solidjs/start/server";

import { loadRuntimeTraumaConfig } from "~/server/config";
import { initializeDatabase } from "~/server/db";
import { formatConfigError, jsonResponse } from "~/server/http/json";
import {
  repairUnavailableTranslation,
  resolveCurrentTranslationReadOnly,
} from "~/server/translation/current-translation";
import { isSupportedLanguageCode } from "~/server/translation/languages";

export async function GET(event: APIEvent): Promise<Response> {
  const memoryId = event.params.memoryId?.trim();
  const langCode = event.params.langCode?.trim();
  if (memoryId === undefined || memoryId === "") {
    return jsonResponse(
      { error: "memoryId must be a non-empty string" },
      { status: 400 },
    );
  }
  if (langCode === undefined || langCode === "" || !isSupportedLanguageCode(langCode)) {
    return jsonResponse(
      { error: "langCode must be a supported translation language" },
      { status: 400 },
    );
  }

  try {
    const config = loadRuntimeTraumaConfig();
    const connection = initializeDatabase(config);
    try {
      const current = await resolveCurrentTranslationReadOnly({
        config,
        langCode,
        memoryId,
        repository: connection.repositories.translations,
      });
      if (current.status === "current") {
        return jsonResponse(
          {
            status: "current",
            job_id: current.job.jobId,
            lang_code: langCode,
            memory_id: memoryId,
            output_hash: current.outputHash,
            output_path: current.outputPath,
            reader_url: current.readerUrl,
            source_hash: current.sourceHash,
          },
          { status: 200 },
        );
      }
      if (current.status === "unavailable") {
        await repairUnavailableTranslation({
          jobId: current.job.jobId,
          reason: current.reason,
          repository: connection.repositories.translations,
        });
        return jsonResponse(
          {
            status: "unavailable",
            error: {
              action: "start_fresh_translation",
              code: "translation_unavailable",
              message: "Translated CONTENT.md is unavailable.",
              reason: current.reason,
            },
            lang_code: langCode,
            memory_id: memoryId,
            source_hash: current.sourceHash,
          },
          { status: 409 },
        );
      }

      return jsonResponse(
        {
          status: "missing",
          lang_code: langCode,
          memory_id: memoryId,
          source_hash: current.sourceHash,
        },
        { status: 404 },
      );
    } finally {
      connection.close();
    }
  } catch (error) {
    return jsonResponse({ error: formatConfigError(error) }, { status: 500 });
  }
}
