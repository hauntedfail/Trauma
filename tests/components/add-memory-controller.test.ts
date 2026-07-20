import { describe, expect, it } from "vitest";

import {
  createAddMemorySubmissionController,
  generateAddMemoryIdempotencyKey,
} from "../../src/components/memories/add-memory-controller";
import type { AddMemorySubmitResult } from "../../src/components/memories/add-memory-submit";

const firstKey = "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef201";
const secondKey = "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef202";

describe("add memory submission controller", () => {
  it("keeps one pending submission above transient views and suppresses stale completion effects", async () => {
    const pending = createDeferred<AddMemorySubmitResult>();
    const submissions: { idempotencyKey: string; url: string }[] = [];
    const settledMemoryIds: string[] = [];
    const navigatedMemoryIds: string[] = [];
    const controller = createAddMemorySubmissionController({
      generateIdempotencyKey: () => firstKey,
      onCreationSettled: (memoryId) => settledMemoryIds.push(memoryId),
      submit: async (input) => {
        submissions.push({
          idempotencyKey: input.idempotencyKey,
          url: input.url,
        });
        return pending.promise;
      },
    });
    const railView = controller.createView();

    controller.setUrl(" https://example.com/article ");
    const railSubmission = railView.submit({
      onCreated: (memoryId) => navigatedMemoryIds.push(`rail:${memoryId}`),
    });
    expect(controller.isSubmitting()).toBe(true);
    expect(controller.canSubmit()).toBe(false);

    railView.dispose();
    const phoneView = controller.createView();
    const coalescedPhoneSubmission = phoneView.submit({
      onCreated: (memoryId) => navigatedMemoryIds.push(`phone:${memoryId}`),
    });

    pending.resolve({ ok: true, memoryId: firstKey });
    await Promise.all([railSubmission, coalescedPhoneSubmission]);

    expect(submissions).toEqual([
      { idempotencyKey: firstKey, url: "https://example.com/article" },
    ]);
    expect(settledMemoryIds).toEqual([firstKey]);
    expect(navigatedMemoryIds).toEqual([]);
    expect(controller.url()).toBe("");
    expect(controller.isSubmitting()).toBe(false);
  });

  it("retains the identity across failed and lost-response retries", async () => {
    const keys: string[] = [];
    const results: AddMemorySubmitResult[] = [
      { ok: false, error: "Failed to save memory. Check the URL and try again." },
      { ok: true, memoryId: firstKey },
    ];
    const controller = createAddMemorySubmissionController({
      generateIdempotencyKey: () => firstKey,
      submit: async (input) => {
        keys.push(input.idempotencyKey);
        return results.shift() ?? { ok: true, memoryId: firstKey };
      },
    });

    controller.setUrl("https://example.com/retry");
    const firstView = controller.createView();
    await firstView.submit({ onCreated: () => undefined });
    firstView.dispose();

    expect(controller.errorMessage()).toContain("Failed to save memory");
    const reopenedView = controller.createView();
    await reopenedView.submit({ onCreated: () => undefined });

    expect(keys).toEqual([firstKey, firstKey]);
  });

  it("rotates the identity only when the normalized URL changes", async () => {
    const generatedKeys = [firstKey, secondKey];
    const observed: { idempotencyKey: string; url: string }[] = [];
    const controller = createAddMemorySubmissionController({
      generateIdempotencyKey: () => generatedKeys.shift() ?? secondKey,
      submit: async (input) => {
        observed.push(input);
        return { ok: false, error: "retry" };
      },
    });
    const view = controller.createView();

    controller.setUrl("https://example.com/one");
    await view.submit({ onCreated: () => undefined });
    controller.setUrl(" https://example.com/one ");
    await view.submit({ onCreated: () => undefined });
    controller.setUrl("https://example.com/two");
    await view.submit({ onCreated: () => undefined });

    expect(observed).toEqual([
      { idempotencyKey: firstKey, url: "https://example.com/one" },
      { idempotencyKey: firstKey, url: "https://example.com/one" },
      { idempotencyKey: secondKey, url: "https://example.com/two" },
    ]);
  });

  it("generates canonical cryptographically-random UUID v7 identities", () => {
    const id = generateAddMemoryIdempotencyKey({
      now: 1_716_000_000_000,
      randomBytes: () =>
        Uint8Array.from([0xab, 0xcd, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0]),
    });

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(id.split("-")[2]?.startsWith("7")).toBe(true);
    expect(["8", "9", "a", "b"]).toContain(id.split("-")[3]?.[0]);
  });
});

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: (value) => resolvePromise?.(value),
  };
}
