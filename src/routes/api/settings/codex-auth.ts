import type { APIEvent } from "@solidjs/start/server";

import { formatConfigError, jsonResponse } from "~/server/http/json";
import { guardMutationRequest } from "~/server/http/mutation-request";
import {
  deleteCodexAuth,
  readCodexAuthStatus,
} from "~/server/settings/codex-auth";
import { CodexAppServerError } from "~/server/translation/codex-app-server";

export async function GET(_event: APIEvent): Promise<Response> {
  try {
    return jsonResponse(await readCodexAuthStatus(), { status: 200 });
  } catch (error) {
    return jsonResponse({ error: formatConfigError(error) }, { status: 500 });
  }
}

export async function DELETE(event: APIEvent): Promise<Response> {
  const guard = guardMutationRequest(event.request);
  if (!guard.ok) {
    return jsonResponse({ error: guard.error }, { status: guard.status });
  }

  try {
    return jsonResponse(await deleteCodexAuth(), { status: 200 });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof CodexAppServerError ? error.message : formatConfigError(error) },
      { status: 500 },
    );
  }
}
