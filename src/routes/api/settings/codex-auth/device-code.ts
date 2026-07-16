import type { APIEvent } from "@solidjs/start/server";

import { formatConfigError, jsonResponse } from "~/server/http/json";
import { guardMutationRequest } from "~/server/http/mutation-request";
import { startCodexDeviceCodeLogin } from "~/server/settings/codex-auth";

export async function POST(event: APIEvent): Promise<Response> {
  const guard = guardMutationRequest(event.request);
  if (!guard.ok) {
    return jsonResponse({ error: guard.error }, { status: guard.status });
  }

  try {
    const result = await startCodexDeviceCodeLogin();
    return jsonResponse(result, {
      status: result.status === "failed" ? 409 : 200,
    });
  } catch (error) {
    return jsonResponse({ error: formatConfigError(error) }, { status: 500 });
  }
}
