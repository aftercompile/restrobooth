import { schema } from "@restrobooth/db";
import { Badge, Card, DataRow } from "@restrobooth/ui";
import { queryAsCurrentUser } from "../../lib/db";
import { createClient } from "../../lib/supabase/server";
import { logout } from "./actions";

/**
 * Placeholder landing for the auth-slice checkpoint. It is deliberately an
 * RLS proof, not a menu yet: it lists exactly the brands and outlets the
 * logged-in user is scoped to see (via queryAsCurrentUser → RLS), so the
 * whole chain — session cookie → getUser → withUser → policy-filtered
 * query — is visibly working before the real menu screens are built on
 * top of it in the next checkpoint.
 */
export default async function MenuPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { brands, outlets } = await queryAsCurrentUser(async (tx) => {
    const brands = await tx.select({ id: schema.brands.id, name: schema.brands.name }).from(schema.brands);
    const outlets = await tx.select({ id: schema.outlets.id, name: schema.outlets.name }).from(schema.outlets);
    return { brands, outlets };
  });

  return (
    <main style={{ padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ fontFamily: "var(--font-display)" }}>Menu</h1>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <span style={{ fontSize: "var(--text-sm)" }}>{user?.email}</span>
          <form action={logout}>
            <button type="submit" style={{ font: "inherit", cursor: "pointer", background: "none", border: "none", textDecoration: "underline", color: "inherit" }}>
              Sign out
            </button>
          </form>
        </div>
      </header>

      <p style={{ fontSize: "var(--text-sm)", opacity: 0.7 }}>
        Auth-slice checkpoint — this lists what RLS lets you see. The real menu UI lands next.
      </p>

      <Card>
        <DataRow label={<strong>Brands you can see</strong>} trailing={<Badge tone="live">{String(brands.length)}</Badge>} />
        {brands.map((b) => (
          <DataRow key={b.id} label={b.name} />
        ))}
      </Card>

      <Card>
        <DataRow label={<strong>Outlets you can see</strong>} trailing={<Badge tone="live">{String(outlets.length)}</Badge>} />
        {outlets.map((o) => (
          <DataRow key={o.id} label={o.name} />
        ))}
      </Card>
    </main>
  );
}
