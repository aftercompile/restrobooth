"use client";

import {
  Badge,
  Button,
  Card,
  DataRow,
  DensityProvider,
  Dialog,
  Input,
  StateRail,
  Tabs,
  TabularNumber,
  useToast,
  type Density,
} from "@restrobooth/ui";
import { useState } from "react";

/**
 * Phase 1 verification checklist: "/style-guide renders all 10 primitives
 * at all three densities." One DensityProvider per section — each section
 * genuinely re-resolves the token set (spacing/motion/type/ground),
 * exactly as a real POS screen or Console page would.
 */
export default function StyleGuidePage() {
  return (
    <main style={{ padding: 32, display: "flex", flexDirection: "column", gap: 32 }}>
      <h1 style={{ fontFamily: "var(--font-display)" }}>RestroBooth — Style Guide</h1>
      <p>Direction B, &quot;Service Board&quot;. Same ten primitives, three densities, one token set.</p>

      <DensitySection density="console" label="Console — editorial, calm, 150ms motion" />
      <DensitySection density="pos" label="POS — dense, dark, zero animation, 44px targets" />
      <DensitySection density="kds" label="KDS — same as POS: dense, dark, zero animation" />
      <DensitySection density="booth" label="Booth — generous, motion-rich, 48px targets" />
    </main>
  );
}

function DensitySection({ density, label }: { density: Density; label: string }) {
  return (
    <section style={{ border: "1px solid #ccc", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "8px 16px", background: "#eee", fontSize: 13, fontWeight: 600 }}>{label}</div>
      <DensityProvider density={density}>
        <PrimitiveGallery />
      </DensityProvider>
    </section>
  );
}

function PrimitiveGallery() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const toast = useToast();

  return (
    <div style={{ padding: "var(--space-3)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      {/* StateRail — the signature element, all four ramp states */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
        <StateRail state="fresh">Table 4 — fresh, 02:10</StateRail>
        <StateRail state="warming">Table 7 — warming, 14:32</StateRail>
        <StateRail state="hot">Table 2 — hot, 21:05</StateRail>
        <StateRail state="critical">Table 9 — critical, 38:47</StateRail>
      </div>

      {/* Button */}
      <div style={{ display: "flex", gap: "var(--space-1)" }}>
        <Button variant="primary" onClick={() => toast("Bill finalised")}>
          Finalise bill
        </Button>
        <Button variant="secondary">Hold</Button>
        <Button variant="danger" onClick={() => setDialogOpen(true)}>
          Void item
        </Button>
      </div>

      {/* Input */}
      <div style={{ maxWidth: 320 }}>
        <Input label="Guest name" placeholder="Optional" />
      </div>

      {/* Badge */}
      <div style={{ display: "flex", gap: "var(--space-1)" }}>
        <Badge tone="neutral">dine-in</Badge>
        <Badge tone="live">live</Badge>
        <Badge tone="warning">86 soon</Badge>
        <Badge tone="critical">voided</Badge>
      </div>

      {/* Card + DataRow, composing StateRail */}
      <Card>
        <DataRow label="Butter Chicken x2" trailing={<TabularNumber>760.00</TabularNumber>} railState="fresh" />
        <DataRow label="Naan x4" trailing={<TabularNumber>240.00</TabularNumber>} railState="warming" />
        <DataRow label="Total" trailing={<TabularNumber>1302.00</TabularNumber>} />
      </Card>

      {/* Tabs */}
      <Tabs
        items={[
          { id: "items", label: "Items", content: <p>Order items go here.</p> },
          { id: "payments", label: "Payments", content: <p>Payment history goes here.</p> },
        ]}
      />

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Void this item?"
        actions={
          <>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setDialogOpen(false);
                toast("Item voided", "critical");
              }}
            >
              Void
            </Button>
          </>
        }
      >
        <p>This requires a reason code once the void flow ships (Phase 2).</p>
      </Dialog>
    </div>
  );
}
