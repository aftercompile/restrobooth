// @ts-check

/**
 * ADR-0001's escape hatch, enforced mechanically instead of left to review:
 * "No Supabase-specific or Vercel-specific API may be called from
 * `packages/domain` or from any UI component." This is what keeps the
 * hosting decision cheap to reverse.
 *
 * Usage: spread `noVendorImports(["packages/domain/**", "packages/ui/**"])`
 * into a package's own eslint.config.mjs. UI components built later inside
 * apps/* should extend this same restriction to their own paths.
 */
export function noVendorImports(files) {
  return {
    files,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@supabase/*", "@supabase/**"],
              message:
                "packages/domain and UI components must not call Supabase directly (ADR-0001). Go through packages/db or a realtime adapter.",
            },
            {
              group: ["@vercel/*", "@vercel/**"],
              message:
                "packages/domain and UI components must not call Vercel-specific APIs directly (ADR-0001). This is what keeps the hosting decision cheap to reverse.",
            },
          ],
        },
      ],
    },
  };
}

export default noVendorImports;
