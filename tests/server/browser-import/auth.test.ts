import { describe, expect, it } from "vitest";

import { verifyBrowserImportAuthorization } from "../../../src/server/browser-import";

describe("browser import auth", () => {
  it("accepts only matching bearer tokens", () => {
    expect(verifyBrowserImportAuthorization("Bearer secret", "secret")).toBe(
      true,
    );
    expect(verifyBrowserImportAuthorization("Bearer wrong", "secret")).toBe(
      false,
    );
    expect(verifyBrowserImportAuthorization("Basic secret", "secret")).toBe(
      false,
    );
    expect(verifyBrowserImportAuthorization(null, "secret")).toBe(false);
    expect(verifyBrowserImportAuthorization("Bearer secret", null)).toBe(false);
  });
});
