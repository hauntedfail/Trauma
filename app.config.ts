import { defineConfig } from "@solidjs/start/config";

type RouterName = "server" | "client" | "server-function";

const DEFAULT_HMR_PORT = 24678;
const HMR_PORT = Number(process.env.TRAUMA_HMR_PORT ?? DEFAULT_HMR_PORT);

const HMR_PORTS: Record<RouterName, number> = {
  client: HMR_PORT,
  server: HMR_PORT + 1,
  "server-function": HMR_PORT + 2,
};

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
  vite({ router }: { router: RouterName }) {
    return {
      server: {
        hmr: {
          port: HMR_PORTS[router],
        },
      },
    };
  },
});
