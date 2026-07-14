import { nextjs } from "@restrobooth/config/eslint/nextjs";
import { noVendorImports } from "@restrobooth/config/eslint/no-vendor-imports";

// ADR-0001, extended to the console (per no-vendor-imports.mjs's own note):
// pages, components, and server actions under app/** must not import
// @supabase/* directly — they go through the lib/supabase/* adapter, which
// is the ONE place vendor coupling is allowed. That's what keeps swapping
// the auth/hosting backend a change in a handful of adapter files, not a
// grep-and-replace across every route.
const config = [...nextjs, noVendorImports(["app/**/*.ts", "app/**/*.tsx"])];

export default config;
