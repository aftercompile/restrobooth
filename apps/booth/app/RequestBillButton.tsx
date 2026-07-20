"use client";

import { useRouter } from "next/navigation";
import { Button } from "@restrobooth/ui";

/**
 * Shown once there's at least one fired/served item — navigating IS the
 * "request bill" action (PayPanel finalises on mount, idempotently, so
 * there's no separate confirm step to duplicate here). Label reflects
 * whether a bill already exists: 'settling' means PayPanel will find one
 * waiting, not create a new one.
 */
export function RequestBillButton({ sessionStatus }: { sessionStatus: string }) {
  const router = useRouter();
  const label = sessionStatus === "settling" ? "Pay bill" : "Request bill";

  return (
    <Button type="button" variant="primary" style={{ width: "100%", marginTop: "var(--space-2)" }} onClick={() => router.push("/pay")}>
      {label}
    </Button>
  );
}
