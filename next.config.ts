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
      // Understand Anything dashboard — serve index.html when accessing
      // /understand-dashboard (without trailing slash or index.html)
      {
        source: "/understand-dashboard",
        destination: "/understand-dashboard/index.html",
      },
      // Understand Anything dashboard JSON endpoints
      // The dashboard JS fetches these from root (e.g. /knowledge-graph.json)
      // but they're served as static files from /understand-dashboard/
      // These rewrites route them to the correct location
      {
        source: "/knowledge-graph.json",
        destination: "/understand-dashboard/knowledge-graph.json",
      },
      {
        source: "/meta.json",
        destination: "/understand-dashboard/meta.json",
      },
      {
        source: "/config.json",
        destination: "/understand-dashboard/config.json",
      },
      {
        source: "/diff-overlay.json",
        destination: "/understand-dashboard/diff-overlay.json",
      },
      {
        source: "/domain-graph.json",
        destination: "/understand-dashboard/domain-graph.json",
      },
      {
        source: "/file-content.json",
        destination: "/understand-dashboard/file-content.json",
      },
      {
        source: "/staleness.json",
        destination: "/understand-dashboard/staleness.json",
      },
    ];
  },
};

export default nextConfig;
