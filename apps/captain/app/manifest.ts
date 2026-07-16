import type { MetadataRoute } from "next";

/**
 * OPEN-DECISIONS.md §10.7: Captain is a PWA, not a native shell — this is
 * the decision's actual install artifact. Next's app/manifest.ts convention
 * serves this at /manifest.webmanifest automatically; proxy.ts's isPublic
 * check keeps it reachable without a session (an "Add to Home Screen" flow
 * that requires login first can't read it).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RestroBooth Captain",
    short_name: "Captain",
    description: "Take order at table, fire KOT, call for bill.",
    start_url: "/floor",
    display: "standalone",
    background_color: "#0c1517",
    theme_color: "#0e4f45",
    orientation: "portrait",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png" },
      { src: "/icon", sizes: "192x192", type: "image/png" },
    ],
  };
}
