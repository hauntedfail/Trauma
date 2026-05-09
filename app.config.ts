import { defineConfig } from "@solidjs/start/config";

export default defineConfig({
  server: {
    externals: {
      traceInclude: [
        "node_modules/drizzle-orm/bun-sqlite/index.cjs",
        "node_modules/drizzle-orm/bun-sqlite/session.cjs",
        "node_modules/drizzle-orm/bun-sqlite/driver.cjs",
        "node_modules/drizzle-orm/bun-sqlite/migrator.cjs",
        "node_modules/drizzle-orm/bun-sqlite/index.js",
        "node_modules/drizzle-orm/bun-sqlite/session.js",
        "node_modules/drizzle-orm/bun-sqlite/driver.js",
        "node_modules/drizzle-orm/bun-sqlite/migrator.js",
      ],
    },
  },
});
