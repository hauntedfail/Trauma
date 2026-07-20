import type { APIEvent } from "@solidjs/start/server";

import { handleReaderMediaRequest } from "~/server/reader/media-proxy";

export function GET(event: APIEvent): Promise<Response> {
  return handleReaderMediaRequest(event.request);
}
