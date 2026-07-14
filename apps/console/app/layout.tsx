import "@restrobooth/ui/src/tokens/index.css";
import { DensityProvider, ToastProvider } from "@restrobooth/ui";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "RestroBooth Console",
  description: "Menu, inventory, reports, AI insights, multi-outlet.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DensityProvider density="console">
          <ToastProvider>{children}</ToastProvider>
        </DensityProvider>
      </body>
    </html>
  );
}
