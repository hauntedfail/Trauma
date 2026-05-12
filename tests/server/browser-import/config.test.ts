import { describe, expect, it } from "vitest";

import {
  isBrowserImportOriginAllowed,
  loadBrowserImportConfig,
} from "../../../src/server/browser-import";

describe("browser import config", () => {
  it("defaults to disabled local extension-only origin handling", () => {
    const config = loadBrowserImportConfig({});

    expect(config).toEqual({
      enabled: false,
      token: null,
      allowedOrigins: [],
      maxBytes: 5_000_000,
    });
    expect(isBrowserImportOriginAllowed("https://example.com", config)).toBe(
      false,
    );
    expect(
      isBrowserImportOriginAllowed("chrome-extension://extension-id", config),
    ).toBe(true);
  });

  it("honors exact configured extension origins", () => {
    const config = loadBrowserImportConfig({
      TRAUMA_BROWSER_IMPORT_ENABLED: "true",
      TRAUMA_BROWSER_IMPORT_TOKEN: " local-token ",
      TRAUMA_BROWSER_IMPORT_ALLOWED_ORIGINS:
        "chrome-extension://allowed, chrome-extension://second",
      TRAUMA_BROWSER_IMPORT_MAX_BYTES: "1000000",
    });

    expect(config).toEqual({
      enabled: true,
      token: "local-token",
      allowedOrigins: ["chrome-extension://allowed", "chrome-extension://second"],
      maxBytes: 1_000_000,
    });
    expect(isBrowserImportOriginAllowed("chrome-extension://allowed", config)).toBe(
      true,
    );
    expect(isBrowserImportOriginAllowed("chrome-extension://other", config)).toBe(
      false,
    );
  });
});
