import { ImageResponse } from "next/og"

import { SITE } from "@/config/site"

export const alt = SITE.defaultTitle
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

/** Default social card: wordmark on ink with the rust bar (no product imagery). */
export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "80px",
        background: "#111111",
        color: "#f4f1ea",
      }}
    >
      <div
        style={{
          fontSize: 220,
          fontWeight: 900,
          letterSpacing: 8,
          lineHeight: 1,
        }}
      >
        DUIS
      </div>
      <div
        style={{ width: 360, height: 24, background: "#b43b0b", marginTop: 32 }}
      />
      <div style={{ fontSize: 44, marginTop: 40 }}>
        Loud basics. Louder graphics.
      </div>
    </div>,
    size,
  )
}
