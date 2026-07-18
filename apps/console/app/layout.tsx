import "@restrobooth/ui/src/tokens/index.css";
import { DensityProvider, ToastProvider } from "@restrobooth/ui";
import { Bricolage_Grotesque, IBM_Plex_Mono, Inter } from "next/font/google";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AmbientBackgroundRoute } from "./AmbientBackgroundRoute";

/**
 * The three faces from docs/DESIGN.md, self-hosted by next/font at build
 * time — no CDN request, no FOIT, no layout shift (next/font emits a
 * matched size-adjust fallback automatically). packages/ui deliberately
 * does NOT load these itself: next/font is a framework-specific API, and
 * ADR-0001 forbids one in any UI component. The app supplies the files;
 * tokens/typography.css just reads the CSS variables.
 */
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RestroBooth Console",
  description: "Menu, inventory, reports, AI insights, multi-outlet.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${inter.variable} ${plexMono.variable}`}>
      <body>
        <AmbientBackgroundRoute />
        <DensityProvider density="console">
          <ToastProvider>{children}</ToastProvider>
        </DensityProvider>
      </body>
    </html>
  );
}
