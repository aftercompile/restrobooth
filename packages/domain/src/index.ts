// Pure billing/tax/KOT/session logic — no I/O, no framework, zero deps.
// The three operational state machines (DOMAIN.md §3.1–3.3) land in Phase
// 3a; the money math and offline conflict resolution (§7, §8) land in
// Phase 3b.
export * from "./tableSession";
export * from "./orderItem";
export * from "./kot";
export * from "./rail";
