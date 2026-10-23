import { readFile } from "node:fs/promises"
import path from "node:path"

import { ImageResponse } from "next/og"

import { SITE } from "@/config/site"

export const alt = SITE.defaultTitle
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

/** Default social card: the emblem and wordmark on ink with the rust bar. */
export default async function OpengraphImage() {
  const emblem = await readFile(
    path.join(process.cwd(), "public/brand/emblem-512.png"),
  )
  const emblemSrc = `data:image/png;base64,${emblem.toString("base64")}`
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
      <div style={{ display: "flex", alignItems: "center", gap: 48 }}>
        <img src={emblemSrc} width={240} height={240} alt="" />
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
