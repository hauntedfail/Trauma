import { describe, expect, it } from "vitest";

import {
  readFlashbackFailure,
  shouldRevalidateBackupFailsafeAfterFlashbackFailure,
} from "../../src/components/reader/flashback-failure";

describe("reader flashback failure handling", () => {
  it("detects backup failsafe alerts returned by flashback persistence", async () => {
    const failure = await readFlashbackFailure(
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
      message: "Flashback failed",
    });
    expect(shouldRevalidateBackupFailsafeAfterFlashbackFailure(failure)).toBe(
      true,
    );
  });

  it("does not revalidate backup failsafe state for successful flashback writes", async () => {
    const failure = await readFlashbackFailure(new Response(null, { status: 204 }));

    expect(failure).toBeUndefined();
    expect(shouldRevalidateBackupFailsafeAfterFlashbackFailure(failure)).toBe(
      false,
    );
  });
});
