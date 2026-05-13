import { describe, expect, it } from "vitest";

import { shouldRevalidateBackupFailsafeAlert } from "../../src/components/memories/AddMemoryForm";

describe("AddMemoryForm failure policy", () => {
  it("refreshes backup failsafe state only for backup failsafe failures", () => {
    expect(
      shouldRevalidateBackupFailsafeAlert({
        ok: false,
        error: "Backup location changed",
        backupFailsafe: true,
      }),
    ).toBe(true);
    expect(
      shouldRevalidateBackupFailsafeAlert({
        ok: false,
        error: "url must be a valid absolute URL",
      }),
    ).toBe(false);
    expect(
      shouldRevalidateBackupFailsafeAlert({
        ok: true,
        memoryId: "018f2d6d-7cbd-7a4c-8d32-9f0b5f0ef111",
      }),
    ).toBe(false);
  });
});
