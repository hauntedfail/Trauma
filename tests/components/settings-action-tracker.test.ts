import { describe, expect, it, vi } from "vitest";

import { createAsyncActionTracker } from "../../src/components/settings/action-state";

describe("createAsyncActionTracker", () => {
  it("keeps independent actions pending until each one finishes", () => {
    const onPendingChange = vi.fn();
    const tracker = createAsyncActionTracker<"language" | "auth">(
      onPendingChange,
    );

    const language = tracker.begin("language");
    const auth = tracker.begin("auth");
    tracker.finish(language);

    expect(tracker.isPending("language")).toBe(false);
    expect(tracker.isPending("auth")).toBe(true);
    expect(onPendingChange).toHaveBeenLastCalledWith(new Set(["auth"]));

    tracker.finish(auth);
    expect(onPendingChange).toHaveBeenLastCalledWith(new Set());
  });

  it("does not let an older generation clear or publish over a newer one", () => {
    const tracker = createAsyncActionTracker<"auth">(() => undefined);
    const first = tracker.begin("auth");
    const second = tracker.begin("auth");

    expect(tracker.isCurrent(first)).toBe(false);
    expect(tracker.isCurrent(second)).toBe(true);
    expect(tracker.isLatestFeedback(first)).toBe(false);
    expect(tracker.isLatestFeedback(second)).toBe(true);

    tracker.finish(first);
    expect(tracker.isPending("auth")).toBe(true);
    tracker.finish(second);
    expect(tracker.isPending("auth")).toBe(false);
  });
});
