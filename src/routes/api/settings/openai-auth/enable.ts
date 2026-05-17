import type { APIEvent } from "@solidjs/start/server";

import { formatConfigError, jsonResponse } from "~/server/http/json";
import { enableSettingsOpenAiAuth } from "~/server/settings/settings";

export async function POST(_event: APIEvent): Promise<Response> {
  try {
    const result = await enableSettingsOpenAiAuth();
    return jsonResponse(result, {
      status: result.status === "not_configured" ? 409 : 200,
    });
  } catch (error) {
    return jsonResponse({ error: formatConfigError(error) }, { status: 500 });
  }
}
