import { beforeEach, describe, expect, it, vi } from "vitest";

const routerMocks = vi.hoisted(() => ({
  query: vi.fn((fn: () => unknown, name: string) =>
    Object.assign(fn, {
      key: name,
      keyFor: (...args: string[]) => `${name}:${args.length}:${args.join(":")}`,
    }),
  ),
  revalidate: vi.fn(),
}));

vi.mock("@solidjs/router", () => routerMocks);
vi.mock("~/server/settings/settings", () => ({
  getSettings: vi.fn(),
  getTranslationSettings: vi.fn(),
}));

const {
  getReaderTranslationSettingsState,
  getSettingsState,
  revalidateSettingsState,
} = await import("../../src/components/settings/settings-loader");

describe("settings loader", () => {
  beforeEach(() => {
    routerMocks.revalidate.mockReset();
  });

  it("revalidates settings page and reader translation settings caches together", async () => {
    routerMocks.revalidate.mockResolvedValue(undefined);

    await revalidateSettingsState();

    expect(routerMocks.revalidate).toHaveBeenCalledWith(getSettingsState.key);
    expect(routerMocks.revalidate).toHaveBeenCalledWith(
      getReaderTranslationSettingsState.key,
    );
    expect(routerMocks.revalidate).toHaveBeenCalledTimes(2);
  });
});
