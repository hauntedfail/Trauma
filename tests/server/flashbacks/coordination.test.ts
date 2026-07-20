import { describe, expect, it } from "vitest";

import { withFlashbackVariantMutationLock } from "../../../src/server/flashbacks/coordination";

describe("Flashback variant mutation coordination", () => {
  it("serializes writers for the same source artifact and releases after rejection", async () => {
    const firstEntered = deferred<void>();
    const releaseFirst = deferred<void>();
    const events: string[] = [];
    const lock = {
      memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f421",
      storePath: "/tmp/trauma-flashback-lock",
      variant: { kind: "source" as const },
    };
    const first = withFlashbackVariantMutationLock(lock, async () => {
      events.push("first-enter");
      firstEntered.resolve();
      await releaseFirst.promise;
      events.push("first-exit");
      throw new Error("first failed");
    });
    await firstEntered.promise;
    const second = withFlashbackVariantMutationLock(lock, async () => {
      events.push("second-enter");
      return "second completed";
    });

    await Promise.resolve();
    expect(events).toEqual(["first-enter"]);
    releaseFirst.resolve();
    await expect(first).rejects.toThrow("first failed");
    await expect(second).resolves.toBe("second completed");
    expect(events).toEqual(["first-enter", "first-exit", "second-enter"]);
  });

  it("serializes different output hashes that publish the same language artifact", async () => {
    const firstEntered = deferred<void>();
    const releaseFirst = deferred<void>();
    let secondEntered = false;
    const base = {
      memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f422",
      storePath: "/tmp/trauma-flashback-lock",
    };
    const first = withFlashbackVariantMutationLock({
      ...base,
      variant: {
        kind: "translation",
        langCode: "ja-JP",
        outputHash: `sha256:${"a".repeat(64)}`,
      },
    }, async () => {
      firstEntered.resolve();
      await releaseFirst.promise;
    });
    await firstEntered.promise;
    const second = withFlashbackVariantMutationLock({
      ...base,
      variant: {
        kind: "translation",
        langCode: "ja-JP",
        outputHash: `sha256:${"b".repeat(64)}`,
      },
    }, async () => {
      secondEntered = true;
    });

    await Promise.resolve();
    expect(secondEntered).toBe(false);
    releaseFirst.resolve();
    await Promise.all([first, second]);
    expect(secondEntered).toBe(true);
  });

  it("allows source and translated artifacts to proceed independently", async () => {
    const sourceEntered = deferred<void>();
    const releaseSource = deferred<void>();
    const base = {
      memoryId: "018f04a2-3c6f-7c88-9a8b-8c99a9b7f423",
      storePath: "/tmp/trauma-flashback-lock",
    };
    const source = withFlashbackVariantMutationLock({
      ...base,
      variant: { kind: "source" },
    }, async () => {
      sourceEntered.resolve();
      await releaseSource.promise;
    });
    await sourceEntered.promise;

    await expect(withFlashbackVariantMutationLock({
      ...base,
      variant: {
        kind: "translation",
        langCode: "ja-JP",
        outputHash: `sha256:${"a".repeat(64)}`,
      },
    }, async () => "translated completed")).resolves.toBe("translated completed");
    releaseSource.resolve();
    await source;
  });
});

function deferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    reject: rejectPromise,
    resolve: resolvePromise,
  };
}
