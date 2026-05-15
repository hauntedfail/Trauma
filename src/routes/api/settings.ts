import type { APIEvent } from "@solidjs/start/server";

import { getSettings } from "~/server/settings/settings";
import { formatConfigError, jsonResponse } from "~/server/http/json";

export async function GET(_event: APIEvent): Promise<Response> {
  try {
    return jsonResponse(await getSettings(), { status: 200 });
  } catch (error) {
    return jsonResponse({ error: formatConfigError(error) }, { status: 500 });
  }
}
