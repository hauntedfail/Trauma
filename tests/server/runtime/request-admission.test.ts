import { describe, expect, it } from "vitest";

import {
  attachRuntimeRequestAdmission,
  releaseRuntimeRequestAdmission,
} from "../../../src/server/runtime/request-admission";
import {
  ensureRuntimeProcessLease,
  runtimeLeaseInputsForConfig,
  suspendRuntimeStorageAdmissionIfIdle,
} from "../../../src/server/runtime/process-lease";
import { createRuntimeConfig } from "./runtime-lease-test-helpers";

describe("runtime request admission", () => {
  it("holds a borrow through response finalization and releases idempotently", async () => {
    const { config } = await createRuntimeConfig();
    const lease = ensureRuntimeProcessLease(config);
    const event = {
      locals: {},
      request: new Request("http://localhost/"),
    };

    attachRuntimeRequestAdmission(event, lease);
    expect(() =>
      suspendRuntimeStorageAdmissionIfIdle(runtimeLeaseInputsForConfig(config))
    ).toThrow(/storage is busy/);

    releaseRuntimeRequestAdmission(event);
    releaseRuntimeRequestAdmission(event);
    expect(
      suspendRuntimeStorageAdmissionIfIdle(runtimeLeaseInputsForConfig(config)),
    ).toBe(true);
    lease.release();
  });

  it("releases the borrow when an aborted request never reaches finalization", async () => {
    const { config } = await createRuntimeConfig();
    const lease = ensureRuntimeProcessLease(config);
    const controller = new AbortController();
    const event = {
      locals: {},
      request: new Request("http://localhost/", { signal: controller.signal }),
    };

    attachRuntimeRequestAdmission(event, lease);
    controller.abort();
    expect(
      suspendRuntimeStorageAdmissionIfIdle(runtimeLeaseInputsForConfig(config)),
    ).toBe(true);
    lease.release();
  });

  it("does not retain a borrow for a request that was already aborted", async () => {
    const { config } = await createRuntimeConfig();
    const lease = ensureRuntimeProcessLease(config);
    const controller = new AbortController();
    controller.abort();
    const event = {
      locals: {},
      request: new Request("http://localhost/", { signal: controller.signal }),
    };

    attachRuntimeRequestAdmission(event, lease);
    expect(
      suspendRuntimeStorageAdmissionIfIdle(runtimeLeaseInputsForConfig(config)),
    ).toBe(true);
    lease.release();
  });
});
