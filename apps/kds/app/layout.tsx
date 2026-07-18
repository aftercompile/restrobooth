import "@restrobooth/ui/src/tokens/index.css";
import { DensityProvider, ToastProvider } from "@restrobooth/ui";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import type { Metadata } from "next";
import type { ReactNode } from "react";

// Same reasoning as apps/pos: Inter for body text (no opinions at reading
// distance), Plex Mono for anything tabular — KOT numbers and ticket ages
// stack in a column and need to align.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "RestroBooth KDS",
  description: "Readable at 2 metres. Ticket aging. One gesture: bump.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable}`}>
      <body>
        <DensityProvider density="kds">
          <ToastProvider>{children}</ToastProvider>
        </DensityProvider>
      </body>
    </html>
  );
}
