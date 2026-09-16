import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["argon2", "better-sqlite3", "file-type", "pyodide"],
  outputFileTracingIncludes: {
    "/api/admin/local/ai/models/\\[modelId\\]/chat": [
      "./src/server/ai/ephemeral-python/worker.mjs",
      "./node_modules/pyodide/**/*",
    ],
  },
};

export default nextConfig;
