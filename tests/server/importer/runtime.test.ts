import { describe, expect, it, vi } from "vitest";

import {
  E2E_FALLBACK_IMPORT_URL,
  E2E_SUCCESS_IMPORT_URL,
  createRuntimeMemoryImporter,
} from "../../../src/server/importer/runtime";
import type { ImporterResult } from "../../../src/server/importer";

const fixtureEnvironment = {
  TRAUMA_BROWSE_FIXTURES: "1",
  TRAUMA_CONFIG_PATH: ".trauma/e2e/trauma.config.json",
  TRAUMA_E2E_IMPORT_FIXTURES: "1",
};

describe("runtime memory importer", () => {
  it("keeps the production validator and importer when E2E fixtures are disabled", async () => {
    const production = createProductionBoundary();
    const runtime = createRuntimeMemoryImporter({
      env: {},
      production,
    });

    await expect(runtime.validateUrl(E2E_SUCCESS_IMPORT_URL)).resolves.toBe(
      `production:${E2E_SUCCESS_IMPORT_URL}`,
    );
    await expect(runtime.importUrl({ url: E2E_SUCCESS_IMPORT_URL })).resolves.toEqual(
      production.result,
    );
    expect(production.validateUrl).toHaveBeenCalledWith(E2E_SUCCESS_IMPORT_URL);
    expect(production.importUrl).toHaveBeenCalledWith({ url: E2E_SUCCESS_IMPORT_URL });
  });

  it("requires every explicit Playwright fixture guard", async () => {
    for (const missing of Object.keys(fixtureEnvironment)) {
      const production = createProductionBoundary();
      const env = { ...fixtureEnvironment };
      delete env[missing as keyof typeof env];
      const runtime = createRuntimeMemoryImporter({ env, production });

      await runtime.validateUrl(E2E_FALLBACK_IMPORT_URL);
      await runtime.importUrl({ url: E2E_FALLBACK_IMPORT_URL });

      expect(production.validateUrl, missing).toHaveBeenCalledTimes(1);
      expect(production.importUrl, missing).toHaveBeenCalledTimes(1);
    }
  });

  it("serves only the exact reserved fixture URLs without touching production I/O", async () => {
    const production = createProductionBoundary();
    const runtime = createRuntimeMemoryImporter({
      env: fixtureEnvironment,
      production,
    });

    await expect(runtime.validateUrl(E2E_SUCCESS_IMPORT_URL)).resolves.toBe(
      E2E_SUCCESS_IMPORT_URL,
    );
    await expect(runtime.importUrl({ url: E2E_SUCCESS_IMPORT_URL })).resolves.toEqual({
      status: "success",
      url: E2E_SUCCESS_IMPORT_URL,
      title: "Deterministic Import Article",
      description: "Local E2E extraction fixture",
      faviconUrl: null,
      markdown: [
        "# Deterministic Import Article",
        "",
        "Fixture extraction stays deterministic without external network access.",
      ].join("\n"),
    });
    await expect(runtime.validateUrl(E2E_FALLBACK_IMPORT_URL)).resolves.toBe(
      E2E_FALLBACK_IMPORT_URL,
    );
    await expect(runtime.importUrl({ url: E2E_FALLBACK_IMPORT_URL })).resolves.toEqual({
      status: "link_only",
      url: E2E_FALLBACK_IMPORT_URL,
      title: "fallback.import.trauma.invalid",
      extractionError: "fetch failed: HTTP 503",
    });
    expect(production.validateUrl).not.toHaveBeenCalled();
    expect(production.importUrl).not.toHaveBeenCalled();
  });

  it("routes non-exact hosts, paths, query strings, and credentials through production policy", async () => {
    const production = createProductionBoundary({
      validateError: new Error("production SSRF policy rejected URL"),
    });
    const runtime = createRuntimeMemoryImporter({
      env: fixtureEnvironment,
      production,
    });
    const nonExactUrls = [
      "https://success.import.trauma.invalid/other",
      `${E2E_SUCCESS_IMPORT_URL}?content=custom`,
      "https://attacker@success.import.trauma.invalid/article",
      "https://arbitrary.import.trauma.invalid/article",
    ];

    for (const url of nonExactUrls) {
      await expect(runtime.validateUrl(url)).rejects.toThrow(
        "production SSRF policy rejected URL",
      );
      await expect(runtime.importUrl({ url })).resolves.toEqual(production.result);
    }

    expect(production.validateUrl).toHaveBeenCalledTimes(nonExactUrls.length);
    expect(production.importUrl).toHaveBeenCalledTimes(nonExactUrls.length);
  });
});

function createProductionBoundary(
  options: { validateError?: Error } = {},
): {
  importUrl: ReturnType<typeof vi.fn<(input: { url: string }) => Promise<ImporterResult>>>;
  result: ImporterResult;
  validateUrl: ReturnType<typeof vi.fn<(url: string) => Promise<string>>>;
} {
  const result: ImporterResult = {
    status: "link_only",
    url: "https://production.example/path",
    title: "production.example",
    extractionError: "production importer result",
  };
  const validateUrl = vi.fn(async (url: string) => {
    if (options.validateError !== undefined) {
      throw options.validateError;
    }
    return `production:${url}`;
  });
  const importUrl = vi.fn(async () => result);

  return { importUrl, result, validateUrl };
}
