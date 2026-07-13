import { base } from "@restrobooth/config/eslint/base";
import { noVendorImports } from "@restrobooth/config/eslint/no-vendor-imports";

export default [...base, noVendorImports(["**/*.ts", "**/*.tsx"])];
