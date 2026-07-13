import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "drizzle-kit";

// dotenv/config's default lookup is relative to process.cwd(), which pnpm
// sets to this package's directory, not the repo root where .env actually
// lives — so it silently no-ops there. Point it at the real location.
// import.meta.dirname isn't populated by drizzle-kit's internal TS loader,
// hence the more portable fileURLToPath(import.meta.url) form.
const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../.env") });

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env at the repo root (docker-compose.yml provides local Postgres on port 54329).",
  );
}

export default {
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
} satisfies Config;
