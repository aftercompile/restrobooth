"use client";

import { Button } from "@restrobooth/ui";

export function PrintButton() {
  return (
    <Button type="button" variant="primary" onClick={() => window.print()}>
      Print
    </Button>
  );
}
