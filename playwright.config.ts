import { randomBytes } from "node:crypto";

import { defineConfig, devices } from "@playwright/test";

import { ensureE2eServerBootFixture } from "./e2e/server-bootstrap";

ensureE2eServerBootFixture();

const host = "127.0.0.1";
const port = 4173;
const hmrBasePort = 24681;
const baseURL = `http://${host}:${port}`;
const e2eControlToken = process.env.TRAUMA_E2E_CONTROL_TOKEN_GENERATED === "1" &&
    process.env.TRAUMA_E2E_CONTROL_TOKEN !== undefined
  ? process.env.TRAUMA_E2E_CONTROL_TOKEN
  : randomBytes(32).toString("base64url");
process.env.TRAUMA_E2E_CONTROL_TOKEN = e2eControlToken;
process.env.TRAUMA_E2E_CONTROL_TOKEN_GENERATED = "1";
const webServerCommand = process.env.CI
  ? `bun --bun .output/server/index.mjs`
  : `bun --bun x vinxi dev`;

export default defineConfig({
  testDir: "./e2e",
  // The suite shares one local TRAUMA_CONFIG_PATH and mutates its SQLite/store fixture.
  workers: 1,
  reporter: process.env.CI
    ? [["dot"], ["html", { open: "never" }]]
    : "list",
  webServer: {
    command: webServerCommand,
    env: {
      HOST: host,
      PORT: String(port),
      TRAUMA_BROWSE_FIXTURES: "1",
      // E2E must never inherit or mutate the user's live Codex auth session.
      TRAUMA_CODEX_APP_SERVER_ENDPOINT: "unix://",
      TRAUMA_CODEX_APP_SERVER_SOCKET_PATH:
        ".trauma/e2e/missing-app-server-control.sock",
      TRAUMA_CONFIG_PATH: ".trauma/e2e/trauma.config.json",
      TRAUMA_E2E_CONTROL: "1",
      TRAUMA_E2E_CONTROL_TOKEN: e2eControlToken,
      TRAUMA_E2E_IMPORT_FIXTURES: "1",
      TRAUMA_HMR_PORT: String(hmrBasePort),
    },
    // This suite mutates its fixture database and must never attach to an
    // arbitrary process that happens to own the test port.
    reuseExistingServer: false,
    timeout: 120_000,
    url: baseURL,
  },
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
