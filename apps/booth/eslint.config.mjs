import { nextjs } from "@restrobooth/config/eslint/nextjs";
import { noVendorImports } from "@restrobooth/config/eslint/no-vendor-imports";

// Same rule as apps/pos/apps/console: app/** must go through lib/db.ts
// rather than importing a vendor SDK directly (ADR-0001).
const config = [...nextjs, noVendorImports(["app/**/*.ts", "app/**/*.tsx"])];

export default config;
