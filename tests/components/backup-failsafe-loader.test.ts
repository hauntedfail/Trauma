import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getBackupFailsafeAlert,
  loadBackupFailsafeAlert,
  revalidateBackupFailsafeAlert,
} from "../../src/components/backup/backup-failsafe-loader";

const routerMocks = vi.hoisted(() => ({
  query: vi.fn((fn: () => unknown, name: string) =>
    Object.assign(fn, {
      key: name,
      keyFor: () => name,
    }),
  ),
  revalidate: vi.fn(),
}));

vi.mock("@solidjs/router", () => routerMocks);

const previousBrowseFixtures = process.env.TRAUMA_BROWSE_FIXTURES;

afterEach(() => {
  if (previousBrowseFixtures === undefined) {
    delete process.env.TRAUMA_BROWSE_FIXTURES;
    return;
  }

  process.env.TRAUMA_BROWSE_FIXTURES = previousBrowseFixtures;
});

describe("backup failsafe loader", () => {
  beforeEach(() => {
    routerMocks.revalidate.mockReset();
  });

  it("does not require runtime config in browse fixture mode", async () => {
    process.env.TRAUMA_BROWSE_FIXTURES = "1";

    await expect(loadBackupFailsafeAlert()).resolves.toBeNull();
  });

  it("revalidates the backup failsafe alert query cache", async () => {
    routerMocks.revalidate.mockResolvedValue(undefined);

    await revalidateBackupFailsafeAlert();

    expect(routerMocks.revalidate).toHaveBeenCalledExactlyOnceWith(
      getBackupFailsafeAlert.key,
    );
  });
});
