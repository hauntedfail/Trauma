import type { APIEvent } from "@solidjs/start/server";

import { formatConfigError, jsonResponse } from "~/server/http/json";
import { enableSettingsOpenAiAuth } from "~/server/settings/settings";

export async function POST(_event: APIEvent): Promise<Response> {
  try {
    return jsonResponse(await enableSettingsOpenAiAuth(), { status: 200 });
  } catch (error) {
    return jsonResponse({ error: formatConfigError(error) }, { status: 500 });
  }
}
