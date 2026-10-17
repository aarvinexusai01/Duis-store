import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"
import { LockIcon } from "lucide-react"

import { Wordmark } from "@/components/brand/wordmark"
import { AnalyticsRoot } from "@/features/analytics/ui/analytics-root"

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

/** Distraction-free checkout (doc/04 §3). */
export default function CheckoutLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <header className="bg-ink text-paper">
        <div className="page-container flex h-16 items-center justify-between">
          <Wordmark />
          <p className="flex items-center gap-2 text-xs tracking-wider uppercase">
            <LockIcon className="size-4" aria-hidden /> Secure checkout
          </p>
          <Link href="/cart" className="text-sm underline underline-offset-4">
            Back to bag
          </Link>
        </div>
      </header>
      <main id="main" className="flex-1">
        <div className="page-container py-8">{children}</div>
      </main>
      <Suspense fallback={null}>
        <AnalyticsRoot />
      </Suspense>
    </>
  )
}
