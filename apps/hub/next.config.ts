import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @restrobooth/ui ships raw source (no build step), so Next needs to run
  // it through its own transform rather than treating it as opaque
  // node_modules — same reasoning as every other app in this monorepo.
  transpilePackages: ["@restrobooth/ui"],
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
};

export default nextConfig;
