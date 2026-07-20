import { createMiddleware } from "@solidjs/start/middleware";

import { loadRuntimeTraumaConfig } from "./server/config";
import {
  isTrustedRequestHost,
  readTrustedHostnames,
} from "./server/http/trusted-host";
import { isRuntimeLeaseFixtureBypassAllowed } from "./server/runtime/fixture-mode";
import {
  ensureRuntimeProcessLeaseFromLoader,
  RuntimeProcessLeaseCoverageError,
  RuntimeProcessLeaseError,
} from "./server/runtime/process-lease";
import {
  attachRuntimeRequestAdmission,
  releaseRuntimeRequestAdmission,
} from "./server/runtime/request-admission";

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
      try {
        const lease = ensureRuntimeProcessLeaseFromLoader(loadRuntimeTraumaConfig);
        attachRuntimeRequestAdmission(event, lease);
      } catch (error) {
        if (
          error instanceof RuntimeProcessLeaseCoverageError ||
          error instanceof RuntimeProcessLeaseError
        ) {
          return new Response("TRAUMA storage is unavailable. Restart TRAUMA and retry.", {
            headers: {
              "cache-control": "no-store",
              "content-type": "text/plain; charset=utf-8",
            },
            status: 503,
          });
        }
        throw error;
      }
    }
  },
  onBeforeResponse(event) {
    releaseRuntimeRequestAdmission(event);
  },
});
