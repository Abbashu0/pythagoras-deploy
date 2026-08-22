import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["argon2", "better-sqlite3", "file-type"],
};

export default nextConfig;
