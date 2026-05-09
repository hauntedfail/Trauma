import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dbCredentials: {
    url: "./.trauma/trauma.sqlite",
  },
  dialect: "sqlite",
  out: "./drizzle",
  schema: "./src/server/db/schema.ts",
});
