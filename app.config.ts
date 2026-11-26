import { defineConfig } from "@solidjs/start/config";
import tailwindcss from "@tailwindcss/vite";

import { resolveNitroOutputConfig } from "./scripts/build-output-config";

export type RouterName = "server" | "client" | "server-function";

const DEFAULT_HMR_PORT = 24678;

// Pre-bundle CommonJS dependencies imported by lazy client routes so cold-cache
// dev navigation never triggers a mid-route Vite re-optimization full reload.
export const CLIENT_OPTIMIZE_DEPS_INCLUDE = ["ipaddr.js"] as const;

function readHmrPortBase(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.TRAUMA_HMR_PORT;
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

export function resolveViteRouterConfig(
  router: RouterName,
  hmrPortBase: number = readHmrPortBase(),
) {
  const hmrPorts: Record<RouterName, number> = {
    client: hmrPortBase,
    server: hmrPortBase + 1,
    "server-function": hmrPortBase + 2,
  };

  return {
    plugins: [tailwindcss()],
    ...(router === "client"
      ? {
          optimizeDeps: {
            include: [...CLIENT_OPTIMIZE_DEPS_INCLUDE],
          },
        }
      : {}),
    server: {
      hmr: {
        port: hmrPorts[router],
      },
    },
  };
}

export function createTraumaAppConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const hmrPortBase = readHmrPortBase(env);
  const output = resolveNitroOutputConfig(env);

  return defineConfig({
    middleware: "./src/middleware.ts",
    server: {
      output,
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
      return resolveViteRouterConfig(router, hmrPortBase);
    },
  });
}

export default createTraumaAppConfig();
