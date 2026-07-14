import { base } from "@restrobooth/config/eslint/base";
import { noVendorImports } from "@restrobooth/config/eslint/no-vendor-imports";

export default [
  ...base,
  noVendorImports(["**/*.ts", "**/*.tsx"]),
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      // This package's tsconfig uses moduleResolution "bundler" (it is only
      // ever consumed by Next), so relative imports must be EXTENSIONLESS.
      // A `.js` suffix — the NodeNext convention that packages/db correctly
      // uses — makes Turbopack look for a literal .js file that doesn't
      // exist, and the build dies with "Module not found" on a file you can
      // see right there on disk. This bit the project twice; it stops here.
      "no-restricted-syntax": [
        "error",
        {
          selector: "ImportDeclaration[source.value=/^\\.{1,2}\\/.*\\.js$/]",
          message:
            "Relative imports in packages/ui must be extensionless (moduleResolution: bundler). Drop the '.js' — Turbopack takes it literally and the build fails.",
        },
        {
          selector: "ExportNamedDeclaration[source.value=/^\\.{1,2}\\/.*\\.js$/]",
          message:
            "Relative exports in packages/ui must be extensionless (moduleResolution: bundler). Drop the '.js' — Turbopack takes it literally and the build fails.",
        },
      ],
    },
  },
];
