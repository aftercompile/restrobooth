import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

/**
 * Generated, not a static asset — the state rail as the app icon (same
 * idea as AppShell's console mark: the product's own signature element
 * used as its logo, not a generic glyph). Enamel ground, brass rail.
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
