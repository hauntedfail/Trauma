import {
  importUrl as importProductionUrl,
  validateImportUrl as validateProductionImportUrl,
  type ImporterResult,
} from "./index";

export const E2E_SUCCESS_IMPORT_URL =
  "https://success.import.trauma.invalid/article";
export const E2E_FALLBACK_IMPORT_URL =
  "https://fallback.import.trauma.invalid/unavailable";

interface RuntimeMemoryImporterEnvironment {
  TRAUMA_BROWSE_FIXTURES?: string;
  TRAUMA_CONFIG_PATH?: string;
  TRAUMA_E2E_IMPORT_FIXTURES?: string;
}

export interface ProductionMemoryImportBoundary {
  importUrl: (input: { url: string }) => Promise<ImporterResult>;
  validateUrl: (url: string) => Promise<string>;
}

interface CreateRuntimeMemoryImporterOptions {
  env?: RuntimeMemoryImporterEnvironment;
  production?: ProductionMemoryImportBoundary;
}

export interface RuntimeMemoryImporter {
  importUrl: (input: { url: string }) => Promise<ImporterResult>;
  validateUrl: (url: string) => Promise<string>;
}

const PRODUCTION_IMPORT_BOUNDARY: ProductionMemoryImportBoundary = {
  importUrl: importProductionUrl,
  validateUrl: validateProductionImportUrl,
};

/**
 * The exact `.invalid` fixtures are owned by Playwright E2E. They are available
 * only with all three fixed E2E guards; every other URL uses the production
 * validator and pinned-network importer unchanged.
 */
export function createRuntimeMemoryImporter(
  options: CreateRuntimeMemoryImporterOptions = {},
): RuntimeMemoryImporter {
  const env: RuntimeMemoryImporterEnvironment = options.env ?? {
    TRAUMA_BROWSE_FIXTURES: process.env.TRAUMA_BROWSE_FIXTURES,
    TRAUMA_CONFIG_PATH: process.env.TRAUMA_CONFIG_PATH,
    TRAUMA_E2E_IMPORT_FIXTURES: process.env.TRAUMA_E2E_IMPORT_FIXTURES,
  };
  const production = options.production ?? PRODUCTION_IMPORT_BOUNDARY;
  const fixturesEnabled = hasExactE2EFixtureEnvironment(env);

  return {
    validateUrl: async (url) => {
      const fixture = fixturesEnabled ? readExactE2EFixture(url) : null;
      return fixture?.url ?? production.validateUrl(url);
    },
    importUrl: async ({ url }) => {
      const fixture = fixturesEnabled ? readExactE2EFixture(url) : null;
      return fixture?.result ?? production.importUrl({ url });
    },
  };
}

function hasExactE2EFixtureEnvironment(
  env: RuntimeMemoryImporterEnvironment,
): boolean {
  return (
    env.TRAUMA_BROWSE_FIXTURES === "1" &&
    env.TRAUMA_E2E_IMPORT_FIXTURES === "1" &&
    env.TRAUMA_CONFIG_PATH === ".trauma/e2e/trauma.config.json"
  );
}

function readExactE2EFixture(
  url: string,
): { url: string; result: ImporterResult } | null {
  if (url === E2E_SUCCESS_IMPORT_URL) {
    return {
      url: E2E_SUCCESS_IMPORT_URL,
      result: {
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
      },
    };
  }

  if (url === E2E_FALLBACK_IMPORT_URL) {
    return {
      url: E2E_FALLBACK_IMPORT_URL,
      result: {
        status: "link_only",
        url: E2E_FALLBACK_IMPORT_URL,
        title: "fallback.import.trauma.invalid",
        extractionError: "fetch failed: HTTP 503",
      },
    };
  }

  return null;
}
