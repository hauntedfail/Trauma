import type { APIEvent } from "@solidjs/start/server";

import { formatConfigError, jsonResponse } from "~/server/http/json";
import { deleteSettingsOpenAiAuth } from "~/server/settings/settings";

export async function DELETE(_event: APIEvent): Promise<Response> {
  try {
    return jsonResponse(await deleteSettingsOpenAiAuth(), { status: 200 });
  } catch (error) {
    return jsonResponse({ error: formatConfigError(error) }, { status: 500 });
  }
}
