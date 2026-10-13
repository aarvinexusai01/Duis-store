import type { Metadata } from "next"
import { Geist } from "next/font/google"

import { cn } from "@/lib/utils"

import "./globals.css"

// Placeholder typeface from the shadcn preset; the Phase 2 design system
// replaces it with the Duis display/body pairing.
const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })

export const metadata: Metadata = {
  title: {
    default: "Duis — Men's Streetwear",
    template: "%s | Duis",
  },
  description:
    "Oversized tees, graphic tees, shirts, hoodies and denim for men. Shipping across India and worldwide.",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className={cn("font-sans", geist.variable)}>
      <body className="bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  )
}
