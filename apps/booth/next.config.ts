import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Same reasoning as apps/pos's next.config.ts: @restrobooth/ui,
  // @restrobooth/db, @restrobooth/domain, and @restrobooth/ai all ship raw
  // source (no build step), so Next needs to run them through its own
  // transform rather than treating them as opaque node_modules.
  transpilePackages: ["@restrobooth/ui", "@restrobooth/db", "@restrobooth/domain", "@restrobooth/ai"],
  serverExternalPackages: ["pg"],
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
};

export default nextConfig;
