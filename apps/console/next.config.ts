import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    // Without this, Turbopack infers the workspace root from the nearest
    // lockfile it finds walking up the tree — which on this machine picks
    // up a stray package-lock.json outside the repo entirely.
    root: path.join(__dirname, "../.."),
  },
};

export default nextConfig;
