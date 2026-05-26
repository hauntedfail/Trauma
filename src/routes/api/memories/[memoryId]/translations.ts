import type { APIEvent } from "@solidjs/start/server";

import { handleStartTranslationRequest } from "~/server/translation/start-translation-route";
import { startTranslationJob } from "~/server/translation/runner";

export function POST(event: APIEvent): Promise<Response> {
  return handleStartTranslationRequest(event, { startTranslationJob });
}
