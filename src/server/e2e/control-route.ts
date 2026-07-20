import type { APIEvent } from "@solidjs/start/server";

import {
  isAuthorizedE2eControlRequest,
  type E2eControlEnvironment,
} from "./control-auth";
import { executeE2eControlRequest } from "./control";
import { parseE2eControlRequest } from "./control-request";
import {
  E2E_CONTROL_MAX_BODY_BYTES,
  type E2eControlRequest,
  type E2eControlResult,
} from "./control-types";
import { jsonResponse } from "../http/json";
import { readJsonMutationRequest } from "../http/mutation-request";

interface E2eControlPostHandlerOptions {
  env?: E2eControlEnvironment;
  execute?: (request: E2eControlRequest) => Promise<E2eControlResult>;
}

export function createE2eControlPostHandler(
  options: E2eControlPostHandlerOptions = {},
) {
  return async function postE2eControl(event: APIEvent): Promise<Response> {
    const env = options.env ?? process.env;
    if (!isAuthorizedE2eControlRequest(event.request, env)) {
      return new Response(null, { status: 404 });
    }

    const body = await readJsonMutationRequest(event.request, {
      contentTypePolicy: "always",
      maxBytes: E2E_CONTROL_MAX_BODY_BYTES,
    });
    if (!body.ok) {
      return jsonResponse({ error: body.error }, { status: body.status });
    }

    const request = parseE2eControlRequest(body.payload);
    if (request === null) {
      return jsonResponse(
        { error: "request body has an invalid E2E fixture action" },
        { status: 400 },
      );
    }

    try {
      const result = await (options.execute ?? executeE2eControlRequest)(request);
      return jsonResponse(
        { ok: true, ...result },
        {
          status: 200,
          headers: { "cache-control": "no-store" },
        },
      );
    } catch (error) {
      console.error("E2E fixture control action failed", error);
      return jsonResponse(
        { error: "E2E fixture control action failed" },
        { status: 500 },
      );
    }
  };
}
