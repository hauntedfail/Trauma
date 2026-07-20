import { describe, expect, it } from "vitest";

import { runDetachedPsychiatristTask } from "../../../src/server/psychiatrist/detached-task";

describe("detached Psychiatrist task", () => {
  it("contains a rejection after the HTTP request has detached", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on("unhandledRejection", onUnhandled);
    try {
      runDetachedPsychiatristTask(async () => {
        throw new Error("secondary persistence failed");
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
