import { base } from "@restrobooth/config/eslint/base";
import { noVendorImports } from "@restrobooth/config/eslint/no-vendor-imports";

export default [
  ...base,
  noVendorImports(["**/*.ts", "**/*.tsx"]),
  {
    files: ["src/**/*.ts"],
    rules: {
      // This package's tsconfig uses moduleResolution "bundler" (it ships
      // raw source straight into Next apps via transpilePackages, same as
      // packages/ui) — a `.js` suffix makes Turbopack look for a literal
      // .js file that doesn't exist. Same trap, same fix, same rule
      // (packages/ui/eslint.config.mjs) — copied here after it bit this
      // package too, the first time anything outside its own vitest suite
      // actually consumed it.
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportDeclaration[source.value=/^\\.{1,2}\\/.*\\.js$/]",
          message:
            "Relative imports in packages/domain must be extensionless (moduleResolution: bundler). Drop the '.js' — Turbopack takes it literally and the build fails.",
        },
        {
          selector: "ExportNamedDeclaration[source.value=/^\\.{1,2}\\/.*\\.js$/]",
          message:
            "Relative exports in packages/domain must be extensionless (moduleResolution: bundler). Drop the '.js' — Turbopack takes it literally and the build fails.",
        },
      ],
    },
  },
];
