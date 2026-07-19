// Pure billing/tax/KOT/session logic — no I/O, no framework, zero deps.
// The three operational state machines (DOMAIN.md §3.1–3.3) landed in Phase
// 3a; the money math (§5, §7) lands in Phase 3b. Offline conflict
// resolution (§8) is an ARCHITECTURE decision (ADR-0004's outbox pattern),
// not a pure function — the client-side outbox itself lives in the apps,
// not here.
export * from "./tableSession";
export * from "./orderItem";
export * from "./kot";
export * from "./rail";
export * from "./money";
export * from "./bill";
export * from "./splitBill";
export * from "./invoiceNumber";
export * from "./qrToken";
