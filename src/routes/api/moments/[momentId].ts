import type { APIEvent } from "@solidjs/start/server";

import { loadRuntimeTraumaConfig, TraumaConfigError } from "~/server/config";
import { initializeDatabase } from "~/server/db";
import { guardMutationRequest } from "~/server/http/mutation-request";

export async function DELETE(event: APIEvent): Promise<Response> {
  const guard = guardMutationRequest(event.request);
  if (!guard.ok) {
    return json({ error: guard.error }, { status: guard.status });
  }

  const momentId = event.params.momentId?.trim();
  if (momentId === undefined || momentId === "") {
    return json({ error: "momentId must be a non-empty string" }, { status: 400 });
  }

  let config;
  try {
    config = loadRuntimeTraumaConfig();
  } catch (error) {
    return json({ error: formatConfigError(error) }, { status: 500 });
  }

  const connection = initializeDatabase(config);
  try {
    const deleted = await connection.repositories.moments.deleteById(
      momentId,
    );
    if (!deleted) {
      return json({ error: "moment was not found" }, { status: 404 });
    }

    return new Response(null, { status: 204 });
  } finally {
    connection.close();
  }
}

function json(body: unknown, init: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

function formatConfigError(error: unknown): string {
  if (error instanceof TraumaConfigError) {
    console.error(error.message);
  }

  return "failed to load Trauma configuration";
}
