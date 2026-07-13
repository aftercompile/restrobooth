// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

/**
 * Shared base flat config. Apps/packages spread this first, then layer
 * their own overrides (Next.js's own config, the vendor-import guard, etc).
 */
export const base = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    ignores: [
      "**/.next/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/node_modules/**",
      "**/drizzle/meta/**",
    ],
  },
);

export default base;
