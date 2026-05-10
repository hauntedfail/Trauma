import { defineConfig, devices } from "@playwright/test";

const port = 4173;
const hmrBasePort = 24681;
const baseURL = `http://localhost:${port}`;
const webServerCommand = process.env.CI
  ? `PORT=${port} bun .output/server/index.mjs`
  : `bun x vinxi dev --port ${port}`;

export default defineConfig({
  testDir: "./e2e",
  webServer: {
    command: webServerCommand,
    env: {
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
