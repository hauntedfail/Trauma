export interface PsychiatristEventPersistenceQueue {
  drain: () => Promise<void>;
  enqueue: (write: () => Promise<void>) => boolean;
}

export function createPsychiatristEventPersistenceQueue(): PsychiatristEventPersistenceQueue {
  let accepting = true;
  let firstFailure: unknown;
  let hasFailure = false;
  let writeChain = Promise.resolve();

  return {
    drain: async () => {
      accepting = false;
      await writeChain;
      if (hasFailure) {
        throw firstFailure;
      }
    },
    enqueue: (write) => {
      if (!accepting) {
        return false;
      }
      writeChain = writeChain.then(async () => {
        try {
          await write();
        } catch (error) {
          if (!hasFailure) {
            firstFailure = error;
            hasFailure = true;
          }
        }
      });
      return true;
    },
  };
}
