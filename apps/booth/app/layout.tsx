import "@restrobooth/ui/src/tokens/index.css";
import { AmbientBackground, DensityProvider, ToastProvider } from "@restrobooth/ui";
import { Bricolage_Grotesque, IBM_Plex_Mono, Inter } from "next/font/google";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

// The three faces from docs/DESIGN.md — same next/font setup as
// apps/console's layout.tsx, the other Bricolage-loading app.
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RestroBooth",
  description: "Browse, get guided, order, pay, feedback.",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "RestroBooth" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0e4f45",
};

/**
 * Booth is the one app that's full-motion by design (DESIGN.md's Direction
 * B per-density table) — `mode="animate"` unconditionally, no route
 * gating like Console's login-only doodle. `useMotionAllowed()` still has
 * final say (prefers-reduced-motion collapses this to the Console budget).
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${inter.variable} ${plexMono.variable}`}>
      <body>
        <AmbientBackground mode="animate" />
        <DensityProvider density="booth">
          <ToastProvider>{children}</ToastProvider>
        </DensityProvider>
      </body>
    </html>
  );
}
