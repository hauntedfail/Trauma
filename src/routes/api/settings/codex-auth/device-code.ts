import type { APIEvent } from "@solidjs/start/server";

import { formatConfigError, jsonResponse } from "~/server/http/json";
import { startCodexDeviceCodeLogin } from "~/server/settings/codex-auth";

export async function POST(_event: APIEvent): Promise<Response> {
  try {
    const result = await startCodexDeviceCodeLogin();
    return jsonResponse(result, {
      status: result.status === "failed" ? 409 : 200,
    });
  } catch (error) {
    return jsonResponse({ error: formatConfigError(error) }, { status: 500 });
  }
}
