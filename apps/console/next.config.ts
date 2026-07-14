import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @restrobooth/ui ships raw .tsx source (package.json "main" points at
  // src/index.ts, no build step) — without this, Next treats it as an
  // opaque node_modules dependency and never runs it through its own
  // TS/JSX transform, which is what actually breaks (not the .js
  // extension on the imports, which Next resolves to .tsx source fine
  // once the package is in scope for compilation at all).
  transpilePackages: ["@restrobooth/ui"],
  turbopack: {
    // Without this, Turbopack infers the workspace root from the nearest
    // lockfile it finds walking up the tree — which on this machine picks
    // up a stray package-lock.json outside the repo entirely.
    root: path.join(__dirname, "../.."),
  },
};

export default nextConfig;
