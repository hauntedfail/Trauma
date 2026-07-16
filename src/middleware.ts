import { createMiddleware } from "@solidjs/start/middleware";

import {
  isTrustedRequestHost,
  readTrustedHostnames,
} from "./server/http/trusted-host";

const trustedHosts = readTrustedHostnames(process.env.TRAUMA_ALLOWED_HOSTS);

export default createMiddleware({
  onRequest(event) {
    if (isTrustedRequestHost(event.request.headers.get("host"), trustedHosts)) {
      return;
    }

    return new Response("Untrusted request host.", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
      status: 421,
    });
  },
});
