import "@restrobooth/ui/src/tokens/index.css";
import { AmbientBackground, DensityProvider } from "@restrobooth/ui";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import type { Metadata } from "next";
import type { ReactNode } from "react";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "RestroBooth",
  description: "Pick a terminal: POS, KDS, or Captain.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${inter.variable}`}>
      <body>
        {/* This whole app IS the "one place the console is allowed a moment
            of composition" (docs/DESIGN.md) — it's a front door, not a
            working screen, so the ambient layer animates unconditionally
            rather than needing the route-aware wrapper apps/console uses. */}
        <AmbientBackground mode="animate" />
        <DensityProvider density="booth">{children}</DensityProvider>
      </body>
    </html>
  );
}
