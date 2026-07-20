import type { APIEvent } from "@solidjs/start/server";

import { formatConfigError, jsonResponse } from "~/server/http/json";
import { guardMutationRequest } from "~/server/http/mutation-request";
import { cancelCodexDeviceCodeLogin } from "~/server/settings/codex-auth";

export async function POST(event: APIEvent): Promise<Response> {
  const guard = guardMutationRequest(event.request);
  if (!guard.ok) {
    return jsonResponse({ error: guard.error }, { status: guard.status });
  }

  try {
    return jsonResponse(await cancelCodexDeviceCodeLogin(), { status: 200 });
  } catch (error) {
    return jsonResponse({ error: formatConfigError(error) }, { status: 500 });
  }
}
