import { describe, expect, it } from "vitest";

import {
  withMemoryOperationMutationLease,
  withMemoryOperationRecoveryLease,
} from "../../../src/server/memories/operation-coordination";

describe("memory operation coordination", () => {
  it("admits concurrent mutations, gives queued recovery exclusivity, and blocks later mutations", async () => {
    const storePath = "/tmp/trauma-operation-coordination-shared";
    const firstEntered = deferred<void>();
    const secondEntered = deferred<void>();
    const releaseMutations = deferred<void>();
    const recoveryEntered = deferred<void>();
    const releaseRecovery = deferred<void>();
    const lateMutationEntered = deferred<void>();
    const order: string[] = [];

    const first = withMemoryOperationMutationLease(storePath, async () => {
      order.push("first-mutation");
      firstEntered.resolve();
      await releaseMutations.promise;
    });
    const second = withMemoryOperationMutationLease(storePath, async () => {
      order.push("second-mutation");
      secondEntered.resolve();
      await releaseMutations.promise;
    });
    await Promise.all([firstEntered.promise, secondEntered.promise]);

    const recovery = withMemoryOperationRecoveryLease(storePath, async () => {
      order.push("recovery");
      recoveryEntered.resolve();
      await releaseRecovery.promise;
    });
    const lateMutation = withMemoryOperationMutationLease(storePath, async () => {
      order.push("late-mutation");
      lateMutationEntered.resolve();
    });
    await flushAsyncWork();
    expect(order).toEqual(["first-mutation", "second-mutation"]);

    releaseMutations.resolve();
    await recoveryEntered.promise;
    expect(order).toEqual([
      "first-mutation",
      "second-mutation",
      "recovery",
    ]);

    releaseRecovery.resolve();
    await lateMutationEntered.promise;
    await Promise.all([first, second, recovery, lateMutation]);
    expect(order).toEqual([
      "first-mutation",
      "second-mutation",
      "recovery",
      "late-mutation",
    ]);
  });

  it("coordinates stores independently", async () => {
    const recoveryEntered = deferred<void>();
    const releaseRecovery = deferred<void>();
    const firstStoreMutationEntered = deferred<void>();
    const secondStoreMutationEntered = deferred<void>();

    const recovery = withMemoryOperationRecoveryLease(
      "/tmp/trauma-operation-coordination-store-a",
      async () => {
        recoveryEntered.resolve();
        await releaseRecovery.promise;
      },
    );
    await recoveryEntered.promise;

    const blockedMutation = withMemoryOperationMutationLease(
      "/tmp/trauma-operation-coordination-store-a",
      async () => firstStoreMutationEntered.resolve(),
    );
    const independentMutation = withMemoryOperationMutationLease(
      "/tmp/trauma-operation-coordination-store-b",
      async () => secondStoreMutationEntered.resolve(),
    );

    await secondStoreMutationEntered.promise;
    await flushAsyncWork();
    expect(firstStoreMutationEntered.settled()).toBe(false);

    releaseRecovery.resolve();
    await firstStoreMutationEntered.promise;
    await Promise.all([recovery, blockedMutation, independentMutation]);
  });

  it("releases mutation and recovery leases after failures", async () => {
    const storePath = "/tmp/trauma-operation-coordination-failures";

    await expect(withMemoryOperationMutationLease(storePath, async () => {
      throw new Error("mutation failed");
    })).rejects.toThrow("mutation failed");
    await expect(withMemoryOperationRecoveryLease(storePath, async () => "recovered"))
      .resolves.toBe("recovered");

    await expect(withMemoryOperationRecoveryLease(storePath, async () => {
      throw new Error("recovery failed");
    })).rejects.toThrow("recovery failed");
    await expect(withMemoryOperationMutationLease(storePath, async () => "mutated"))
      .resolves.toBe("mutated");
  });
});

function deferred<T>() {
  let isSettled = false;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = (value) => {
      isSettled = true;
      resolvePromise(value);
    };
  });
  return {
    promise,
    resolve,
    settled: () => isSettled,
  };
}

async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolveFlush) => setImmediate(resolveFlush));
}
