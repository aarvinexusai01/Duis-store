import type { Metadata, Viewport } from "next"
import { Anton, Geist } from "next/font/google"

import { Toaster } from "@/components/ui/sonner"
import { SITE } from "@/config/site"
import { cn } from "@/lib/utils"

import "./globals.css"

const display = Anton({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
  display: "swap",
})
const body = Geist({ subsets: ["latin"], variable: "--font-body" })

export const metadata: Metadata = {
  // The build has no environment (ADR-016), so this falls back to localhost
  // there. Every indexable page resolves its metadata per request, in the
  // server process, where APP_URL is the real origin.
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: { default: SITE.defaultTitle, template: `%s | ${SITE.name}` },
  description: SITE.defaultDescription,
  applicationName: SITE.name,
  formatDetection: { telephone: false, email: false, address: false },
  openGraph: { siteName: SITE.name, locale: "en_IN", type: "website" },
  // Served from site settings (or a monogram), so staff can change it.
  icons: { icon: "/brand/icon" },
}

export const viewport: Viewport = {
  themeColor: "#111111",
  colorScheme: "light",
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className={cn(display.variable, body.variable)}>
      <body className="flex min-h-dvh flex-col bg-background font-sans text-foreground antialiased">
        {children}
        <Toaster position="top-center" />
      </body>
    </html>
  )
}
