import { nextjs } from "@restrobooth/config/eslint/nextjs";
import { noVendorImports } from "@restrobooth/config/eslint/no-vendor-imports";

// Same rule as apps/console and apps/pos: app/** must go through
// lib/supabase/* rather than importing @supabase/* directly (ADR-0001).
const config = [...nextjs, noVendorImports(["app/**/*.ts", "app/**/*.tsx"])];

export default config;
