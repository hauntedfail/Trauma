import type { APIEvent } from "@solidjs/start/server";

import {
  CollectionPageInputError,
  parseExplicitCollectionPageRequest,
} from "~/server/browse/collection-page";
import { TraumaConfigError } from "~/server/config";
import { loadFlashbackBrowsePage } from "~/server/flashbacks/browse";

export async function GET(event: APIEvent): Promise<Response> {
  try {
    const request = parseExplicitCollectionPageRequest(
      "flashbacks",
      event.request,
    );
    return json(
      await loadFlashbackBrowsePage({
        cursor: request.cursorToken,
        limit: request.limit,
      }),
      200,
    );
  } catch (error) {
    if (error instanceof CollectionPageInputError) {
      return json({ error: error.message }, 400);
    }
    if (error instanceof TraumaConfigError) {
      return json({ error: "failed to load Trauma configuration" }, 500);
    }
    throw error;
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
