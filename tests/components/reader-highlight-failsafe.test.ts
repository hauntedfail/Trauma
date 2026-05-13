import { describe, expect, it } from "vitest";

import {
  readHighlightFailure,
  shouldRevalidateBackupFailsafeAfterHighlightFailure,
} from "../../src/components/reader/highlight-failure";

describe("reader highlight failure handling", () => {
  it("detects backup failsafe alerts returned by highlight persistence", async () => {
    const failure = await readHighlightFailure(
      new Response(
        JSON.stringify({
          error: "Backup location changed",
          backupFailsafe: {
            kind: "backup-path-changed",
            message: "Backup location changed",
          },
        }),
        {
          status: 409,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    expect(failure).toEqual({
      backupFailsafe: true,
      message: "Highlight failed",
    });
    expect(shouldRevalidateBackupFailsafeAfterHighlightFailure(failure)).toBe(
      true,
    );
  });

  it("does not revalidate backup failsafe state for successful highlight writes", async () => {
    const failure = await readHighlightFailure(new Response(null, { status: 204 }));

    expect(failure).toBeUndefined();
    expect(shouldRevalidateBackupFailsafeAfterHighlightFailure(failure)).toBe(
      false,
    );
  });
});
