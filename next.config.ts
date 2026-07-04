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
    ];
  },
};

export default nextConfig;
