import "@restrobooth/ui/src/tokens/index.css";
import { AmbientBackground, DensityProvider, ToastProvider } from "@restrobooth/ui";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import type { Metadata } from "next";
import type { ReactNode } from "react";

// POS density has no display face (DESIGN.md: "Inter is boring on purpose
// at POS density — you want a typeface with no opinions"). Body + data
// fonts only, self-hosted the same way apps/console does with next/font.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RestroBooth POS",
  description: "Speed. Keyboard-first. Zero latency.",
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
