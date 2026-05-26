import type { APIEvent } from "@solidjs/start/server";

import { formatConfigError, jsonResponse } from "~/server/http/json";
import { readTranslationJobSnapshot } from "~/server/translation/runner";

export async function GET(event: APIEvent): Promise<Response> {
  const jobId = event.params.jobId?.trim();
  if (jobId === undefined || jobId === "") {
    return jsonResponse(
      { error: "jobId must be a non-empty string" },
      { status: 400 },
    );
  }

  try {
    const snapshot = await readTranslationJobSnapshot({ jobId });
    if (snapshot === null) {
      return jsonResponse({ error: "translation job was not found" }, { status: 404 });
    }

    return jsonResponse(snapshot, { status: 200 });
  } catch (error) {
    return jsonResponse({ error: formatConfigError(error) }, { status: 500 });
  }
}
