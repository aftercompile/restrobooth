import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

/**
 * Generated, not a static asset — same treatment as apps/captain's icon.tsx
 * (the state rail as the app icon, enamel ground, brass rail). Hub keeps the
 * "RB" mark since it IS the RestroBooth front door — the other apps get
 * their own two-letter mark instead so tabs stay distinguishable once a
 * tile hands off to one of them.
 */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0e4f45",
        }}
      >
        <div style={{ width: 64, height: 280, background: "#c89b3c", borderRadius: 16, marginRight: 48 }} />
        <div style={{ display: "flex", flexDirection: "column", fontFamily: "sans-serif" }}>
          <span style={{ color: "#edf1ef", fontSize: 96, fontWeight: 700, lineHeight: 1 }}>RB</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
