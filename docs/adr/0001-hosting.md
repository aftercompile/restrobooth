# ADR-0001 — Hosting and the free-tier ceiling

**Status:** Accepted
**Date:** 2026-07-13

## Context

The brief mandates free tier throughout and flags two traps to verify against live docs rather than training data. Both are real, and **one is worse than the brief assumes.**

### Verified against live docs, 2026-07-13

**Vercel** — [Fair Use Guidelines](https://vercel.com/docs/limits/fair-use-guidelines) (page last updated 2026-06-16):

> **"Hobby teams are restricted to non-commercial personal use only. All commercial usage of the platform requires either a Pro or Enterprise plan."**
>
> Commercial usage is *"any Deployment that is used for the purpose of financial gain of **anyone** involved in **any part of the production** of the project, including a paid employee or consultant writing the code."* The enumerated examples include **"any method of requesting or processing payment from visitors of the site."** Even soliciting donations counts.

Hobby usage guidelines: 100 GB fast data transfer, 10 GB fast origin transfer, 4 CPU-hrs active CPU, 360 GB-hrs provisioned memory, 1 M function invocations, 5 K image transformations per month.

**Supabase** — [Pricing](https://supabase.com/pricing):

| | Free | Pro ($25/mo) |
|---|---|---|
| Database | **500 MB** | 8 GB, then $0.125/GB |
| Egress | 5 GB | 250 GB, then $0.09/GB |
| **Realtime concurrent connections** | **200** | 500, then $10/1 000 |
| Realtime messages | 2 M | 5 M, then $2.50/M |
| MAU | 50 000 | 100 000 |
| Edge Function invocations | 500 K | 2 M |
| **Project pausing** | **after 1 week of inactivity** | never |

### What this means for RestroBooth specifically

**1. The Hobby→Pro trigger is Phase 5, not "first paying customer."** The Booth's pay-at-table feature *is* "requesting or processing payment from visitors of the site" — the exact language Vercel uses to define commercial usage. The moment we demo a real UPI payment from a guest's phone, we are in violation on Hobby. Worse, the definition covers *anyone* profiting from *any part of production*, so even a paid consultant writing the code triggers it. **This is a hard, early gate, and the brief's framing ("fine for dev, not for a paying restaurant") understates how soon it arrives.**

**2. Supabase Free cannot hold the data.** From [ERD.md](../ERD.md) §6, 20 outlets generate ~48 M rows/year (~132 K/day). At a conservative 200 bytes/row with indexes, **500 MB is exhausted in under a month at chain scale, and inside a year for a single busy outlet.** Free tier is not a deployment target; it is a development environment.

**3. Free-tier project pausing is incompatible with a restaurant.** A project that sleeps after a week of inactivity is fine for a side project and fatal for a Monday-closed restaurant.

**4. 200 concurrent Realtime connections is tighter than it looks.** A KDS holds a socket open for an entire service. Per outlet: 1–3 KDS + 2–4 POS + 3–8 captain phones + every guest with the Booth open. A single busy outlet on a Saturday can approach 50 concurrent sockets by itself; 20 outlets blow past Pro's 500 too. See [ADR-0005](0005-realtime-transport.md).

## Decision

**Supabase Free + Vercel Hobby for development only. Both are dev-environment choices, and neither is a deployment target.**

Migration triggers — **whichever comes first**:

| Trigger | Move to | Why |
|---|---|---|
| **Phase 5 begins** (Booth takes a real payment) | **Vercel Pro** ($20/user/mo) | Contractually required. Processing guest payments is commercial use. |
| First real guest PII or a real bill is stored | **Supabase Pro** ($25/mo) | No pausing, backups, and a DB that fits. |
| Any pilot at a real restaurant | **Both** | Non-negotiable. |

**Baseline production cost for the single-outlet pilot: ~$45/month** (Supabase Pro $25 + Vercel Pro $20/seat). That is the real number and it should be planned for, not discovered.

Everything else stays free-tier and stays free: GitHub Actions, Sentry, PostHog.

## Consequences

- **Positive:** dev costs nothing. The paid path is $45/mo — trivially affordable — so this is a scheduling fact, not a business risk.
- **Positive:** we know the trigger *now* and can plan for it rather than hitting it mid-pilot.
- **Negative:** Supabase Free's 500 MB means the Phase 1 seed (a realistic chain: 3 outlets, 120-item menu, and enough order history to make reports meaningful) must be **deliberately sized to fit**. Seed a few weeks of history, not a year. Note this in the seed script.
- **Negative:** free-tier pausing will bite during slow development weeks. Accept it; a keepalive ping to defeat it would violate the spirit of the fair-use terms and we will not do it.

## Escape hatch (the "no lock-in" requirement)

The whole point of "free now, commercial later" is that neither choice traps us:

- **Postgres is Postgres.** Drizzle + plain SQL migrations means Supabase can be swapped for Neon, RDS, or self-hosted Postgres. The things we would lose are Auth, Realtime, and Storage — so keep each behind a thin interface (`packages/db`, `packages/realtime`) and never let Supabase-specific calls leak into `packages/domain` (which has zero deps anyway) or into UI components.
- **Vercel is Next.js.** Next.js runs on any Node host; Cloudflare Workers, Railway, and Fly.io are all viable. Avoid Vercel-proprietary primitives (Edge Config, Vercel KV) precisely so this stays true.
- **RLS is the security model regardless of host** — that decision is host-independent and is the one thing we genuinely cannot move away from cheaply. That is fine; it is also the right decision.

**Rule going forward: no Supabase-specific or Vercel-specific API may be called from `packages/domain` or from any UI component. Both are reachable only through `packages/db` and a realtime adapter.**
