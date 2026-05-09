import { defineConfig, devices } from "@playwright/test";

const port = 4173;
const baseURL = `http://127.0.0.1:${port}`;
const webServerCommand = `bun run dev -- --port ${port}`;

export default defineConfig({
  testDir: "./e2e",
  webServer: {
    command: webServerCommand,
    env: {
      TRAUMA_CONFIG_PATH: ".trauma/e2e/trauma.config.json",
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
