import { describe, expect, it } from "vitest";

import { readFlashbackBackupWarning } from "../../src/components/reader/flashback-backup-warning";
import { readFlashbackDurabilityWarning } from "../../src/components/reader/flashback-durability-warning";
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

  it("reads the explicit backup warning from a successful durable flashback response", () => {
    expect(readFlashbackBackupWarning({
      result: {
        flashbacks: [],
        backup: {
          status: "failed",
          warning: {
            code: "backup_enqueue_failed",
            message: "Flashback was saved, but backup enqueue failed.",
          },
        },
      },
    })).toEqual({
      status: "failed",
      code: "backup_enqueue_failed",
      message: "Flashback was saved, but backup enqueue failed.",
    });
    expect(readFlashbackBackupWarning({ result: { flashbacks: [] } })).toBeUndefined();
  });

  it("keeps the reader success path wired to surface durable backup warnings", async () => {
    const source = await import("node:fs").then(({ readFileSync }) =>
      readFileSync("src/components/reader/MemoryReader.tsx", "utf8"),
    );

    expect(source).toContain("readFlashbackBackupWarning");
    expect(source).toContain("input.setErrorMessage(warning.message)");
  });

  it("strictly reads a committed export-durability warning", () => {
    const warning = readFlashbackDurabilityWarning({
      result: {
        flashbacks: [],
        durability: {
          status: "unconfirmed",
          warning: {
            code: "flashback_export_durability_unconfirmed",
            message:
              "Flashback change was saved, but export durability could not be confirmed.",
          },
        },
      },
    });

    expect(warning).toEqual({
      code: "flashback_export_durability_unconfirmed",
      message:
        "Flashback change was saved, but export durability could not be confirmed.",
      status: "unconfirmed",
    });
    expect(readFlashbackDurabilityWarning({
      result: {
        durability: {
          status: "unconfirmed",
          warning: { code: "wrong", message: "unsafe" },
        },
      },
    })).toBeUndefined();
  });

  it("keeps committed durability uncertainty on the success revalidation path", async () => {
    const source = await import("node:fs").then(({ readFileSync }) =>
      readFileSync("src/components/reader/MemoryReader.tsx", "utf8"),
    );

    expect(source).toContain("readFlashbackDurabilityWarning(payload)");
    expect(source).toContain("input.onFlashbacksChanged(payload.result.flashbacks)");
    expect(source).toContain("input.onSuccess()");
  });
});
