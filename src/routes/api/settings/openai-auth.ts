import type { APIEvent } from "@solidjs/start/server";

import { formatConfigError, jsonResponse } from "~/server/http/json";
import { guardMutationRequest } from "~/server/http/mutation-request";
import { deleteCodexAuth } from "~/server/settings/codex-auth";
import { safeCodexAppServerErrorMessage } from "~/server/translation/codex-app-server";

export async function DELETE(event: APIEvent): Promise<Response> {
  const guard = guardMutationRequest(event.request);
  if (!guard.ok) {
    return jsonResponse({ error: guard.error }, { status: guard.status });
  }

  try {
    return jsonResponse(await deleteCodexAuth(), { status: 200 });
  } catch (error) {
    return jsonResponse(
      {
        error: safeCodexAppServerErrorMessage(
          error,
          formatConfigError(error),
        ),
      },
      { status: 500 },
    );
  }
}
