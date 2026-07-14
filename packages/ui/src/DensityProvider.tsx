"use client";

import { createContext, useContext, type ReactNode } from "react";

export type Density = "booth" | "pos" | "kds" | "console";

const DensityContext = createContext<Density>("console");

export function useDensity(): Density {
  return useContext(DensityContext);
}

/**
 * The one thing that switches Booth / POS+KDS / Console: sets
 * data-density on a wrapping element, which every token in
 * tokens/*.css keys off. Nest a different density inside another only if
 * you genuinely need a mixed surface (e.g. an embedded receipt preview) —
 * normally one provider wraps the whole app shell.
 */
export function DensityProvider({ density, children }: { density: Density; children: ReactNode }) {
  return (
    <DensityContext.Provider value={density}>
      <div data-density={density}>{children}</div>
    </DensityContext.Provider>
  );
}
