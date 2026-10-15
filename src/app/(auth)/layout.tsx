import type { Metadata } from "next"
import Link from "next/link"

import { Wordmark } from "@/components/brand/wordmark"

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

/** Minimal chrome for sign-in pages (doc/04 §3). */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="bg-ink text-paper">
        <div className="page-container flex h-16 items-center justify-between">
          <Wordmark />
          <Link href="/" className="text-sm underline underline-offset-4">
            Back to shop
          </Link>
        </div>
      </header>
      <main id="main" className="flex flex-1 justify-center px-4 py-12">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </>
  )
}
