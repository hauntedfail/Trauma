import type {
  RuntimeProcessLease,
  RuntimeProcessLeaseBorrow,
} from "./runtime-lease-types";

interface RuntimeRequestAdmissionEvent {
  locals: object;
  request: Request;
}

interface RuntimeRequestAdmission {
  abort: () => void;
  borrow: RuntimeProcessLeaseBorrow;
  signal: AbortSignal;
}

const admissions = new WeakMap<object, RuntimeRequestAdmission>();

/** Holds process storage admission until the response is finalized or aborted. */
export function attachRuntimeRequestAdmission(
  event: RuntimeRequestAdmissionEvent,
  lease: RuntimeProcessLease,
): void {
  releaseRuntimeRequestAdmission(event);
  const borrow = lease.borrow([]);
  const abort = () => releaseRuntimeRequestAdmission(event);
  const admission = { abort, borrow, signal: event.request.signal };
  admissions.set(event.locals, admission);
  event.request.signal.addEventListener("abort", abort, { once: true });
  if (event.request.signal.aborted) {
    abort();
  }
}

export function releaseRuntimeRequestAdmission(
  event: Pick<RuntimeRequestAdmissionEvent, "locals">,
): void {
  const admission = admissions.get(event.locals);
  if (admission === undefined) {
    return;
  }
  admissions.delete(event.locals);
  admission.signal.removeEventListener("abort", admission.abort);
  admission.borrow.release();
}
