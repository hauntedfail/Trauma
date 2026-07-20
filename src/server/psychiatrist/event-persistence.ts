import {
  PSYCHIATRIST_TURN_LIMITS,
  PsychiatristEventLimitError,
  type PsychiatristEventPersistenceLimits,
} from "./limits";

export { PsychiatristEventLimitError } from "./limits";

export type { PsychiatristEventPersistenceLimits } from "./limits";

export interface PsychiatristEventPersistenceQueue {
  drain: () => Promise<void>;
  enqueue: (write: () => Promise<void>, byteLength?: number) => boolean;
}

const defaultLimits = PSYCHIATRIST_TURN_LIMITS.eventPersistence;

export function createPsychiatristEventPersistenceQueue(
  limits: PsychiatristEventPersistenceLimits = defaultLimits,
): PsychiatristEventPersistenceQueue {
  validateLimits(limits);
  let accepting = true;
  let firstFailure: unknown;
  let hasFailure = false;
  let pendingBytes = 0;
  let pendingEvents = 0;
  let turnBytes = 0;
  let turnEvents = 0;
  let writeChain = Promise.resolve();

  const recordFailure = (error: unknown) => {
    accepting = false;
    if (!hasFailure) {
      firstFailure = error;
      hasFailure = true;
    }
  };
  const rejectLimit = (
    kind: ConstructorParameters<typeof PsychiatristEventLimitError>[0],
  ): false => {
    recordFailure(new PsychiatristEventLimitError(kind));
    return false;
  };

  return {
    drain: async () => {
      accepting = false;
      await writeChain;
      if (hasFailure) {
        throw firstFailure;
      }
    },
    enqueue: (write, byteLength = 0) => {
      if (!accepting) {
        return false;
      }
      if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
        throw new TypeError("Psychiatrist event byte length must be a non-negative safe integer.");
      }
      if (byteLength > limits.maxEventBytes) {
        return rejectLimit("event_bytes");
      }
      if (turnEvents + 1 > limits.maxTurnEvents) {
        return rejectLimit("turn_events");
      }
      if (turnBytes + byteLength > limits.maxTurnBytes) {
        return rejectLimit("turn_bytes");
      }
      if (pendingEvents + 1 > limits.maxPendingEvents) {
        return rejectLimit("pending_events");
      }
      if (pendingBytes + byteLength > limits.maxPendingBytes) {
        return rejectLimit("pending_bytes");
      }

      pendingEvents += 1;
      pendingBytes += byteLength;
      turnEvents += 1;
      turnBytes += byteLength;
      writeChain = writeChain.then(async () => {
        try {
          await write();
        } catch (error) {
          recordFailure(error);
        } finally {
          pendingEvents -= 1;
          pendingBytes -= byteLength;
        }
      });
      return true;
    },
  };
}

function validateLimits(limits: PsychiatristEventPersistenceLimits): void {
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new TypeError("Psychiatrist event limits must be positive safe integers.");
    }
  }
}
