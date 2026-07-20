import { createMiddleware } from "@solidjs/start/middleware";

import { loadRuntimeTraumaConfig } from "./server/config";
import {
  isTrustedRequestHost,
  readTrustedHostnames,
} from "./server/http/trusted-host";
import { isRuntimeLeaseFixtureBypassAllowed } from "./server/runtime/fixture-mode";
import { ensureRuntimeProcessLeaseFromLoader } from "./server/runtime/process-lease";

const trustedHosts = readTrustedHostnames(process.env.TRAUMA_ALLOWED_HOSTS);

export default createMiddleware({
  onRequest(event) {
    if (!isTrustedRequestHost(event.request.headers.get("host"), trustedHosts)) {
      return new Response("Untrusted request host.", {
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
        status: 421,
      });
    }

    if (!isRuntimeLeaseFixtureBypassAllowed(process.env, event.request)) {
      ensureRuntimeProcessLeaseFromLoader(loadRuntimeTraumaConfig);
    }
  },
});
