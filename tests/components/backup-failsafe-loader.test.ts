import { afterEach, describe, expect, it } from "vitest";

import { loadBackupFailsafeAlert } from "../../src/components/backup/backup-failsafe-loader";

const previousBrowseFixtures = process.env.TRAUMA_BROWSE_FIXTURES;

afterEach(() => {
  if (previousBrowseFixtures === undefined) {
    delete process.env.TRAUMA_BROWSE_FIXTURES;
    return;
  }

  process.env.TRAUMA_BROWSE_FIXTURES = previousBrowseFixtures;
});

describe("backup failsafe loader", () => {
  it("does not require runtime config in browse fixture mode", async () => {
    process.env.TRAUMA_BROWSE_FIXTURES = "1";

    await expect(loadBackupFailsafeAlert()).resolves.toBeNull();
  });
});
