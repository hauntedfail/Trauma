import { defineConfig, devices } from "@playwright/test";

const host = "127.0.0.1";
const port = 4173;
const hmrBasePort = 24681;
const baseURL = `http://${host}:${port}`;
const webServerCommand = process.env.CI
  ? `bun --bun .output/server/index.mjs`
  : `bun --bun x vinxi dev`;

export default defineConfig({
  testDir: "./e2e",
  // The suite shares one local TRAUMA_CONFIG_PATH and mutates its SQLite/store fixture.
  workers: 1,
  webServer: {
    command: webServerCommand,
    env: {
      HOST: host,
      PORT: String(port),
      TRAUMA_BROWSE_FIXTURES: "1",
      TRAUMA_CONFIG_PATH: ".trauma/e2e/trauma.config.json",
      TRAUMA_HMR_PORT: String(hmrBasePort),
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: baseURL,
  },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
