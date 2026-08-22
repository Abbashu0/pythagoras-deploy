import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/content/schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
});
