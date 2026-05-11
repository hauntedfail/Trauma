import { defineConfig } from "@solidjs/start/config";
import tailwindcss from "@tailwindcss/vite";

type RouterName = "server" | "client" | "server-function";

const DEFAULT_HMR_PORT = 24678;

function readHmrPortBase(): number {
  const raw = process.env.TRAUMA_HMR_PORT;
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_HMR_PORT;
  }
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535 - 2) {
    throw new Error(
      `Invalid TRAUMA_HMR_PORT: ${raw} (expected integer in 1..65533)`,
    );
  }
  return parsed;
}

const HMR_PORT = readHmrPortBase();

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
        "node_modules/entities/**",
        "node_modules/htmlparser2/node_modules/entities/**",
      ],
    },
  },
  vite({ router }: { router: RouterName }) {
    return {
      plugins: [tailwindcss()],
      server: {
        hmr: {
          port: HMR_PORTS[router],
        },
      },
    };
  },
});
