import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

const emptyGlobalGitConfig = fileURLToPath(
  new URL("./tests/fixtures/empty.gitconfig", import.meta.url),
);

export default defineConfig({
  plugins: [solid({ ssr: true })],
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    env: {
      GIT_CONFIG_GLOBAL: emptyGlobalGitConfig,
    },
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    testTimeout: 10_000,
  },
});
