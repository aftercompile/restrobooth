import "@restrobooth/ui/src/tokens/index.css";
import { AmbientBackground, DensityProvider, ToastProvider } from "@restrobooth/ui";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

// Same density as apps/pos — DensityProvider has no separate "captain"
// bucket, and it doesn't need one: PRD.md describes Captain as "dense,
// touch-first", the same goals POS density already encodes (dark, zero
// animation, no display face). The phone form factor changes layout, not
// the design system's density tier.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RestroBooth Captain",
  description: "Take order at table, fire KOT, call for bill.",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Captain" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0e4f45",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable}`}>
      <body>
        <AmbientBackground mode="static" />
        <DensityProvider density="pos">
          <ToastProvider>{children}</ToastProvider>
        </DensityProvider>
      </body>
    </html>
  );
}
