import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  async rewrites() {
    return [
      // Serve the Pythagoras app's index.html at the root
      {
        source: "/",
        destination: "/pythagoras/index.html",
      },
      // Proxy Understand Anything viewer (runs on port 5174) through Next.js
      // so it's accessible via the preview URL without needing Caddy changes.
      {
        source: "/understand-dashboard/:path*",
        destination: "http://127.0.0.1:5174/:path*",
      },
    ];
  },
};

export default nextConfig;
