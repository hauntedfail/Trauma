import type { APIEvent } from "@solidjs/start/server";

import { formatConfigError, jsonResponse } from "~/server/http/json";
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

export async function DELETE(_event: APIEvent): Promise<Response> {
  try {
    return jsonResponse(await deleteCodexAuth(), { status: 200 });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof CodexAppServerError ? error.message : formatConfigError(error) },
      { status: 500 },
    );
  }
}
