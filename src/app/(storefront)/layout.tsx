import { Suspense } from "react"

import { DisplayCurrencyProvider } from "@/components/brand/display-currency"
import { SiteFooter } from "@/components/layout/site-footer"
import { SiteHeader } from "@/components/layout/site-header"
import { AnalyticsRoot } from "@/features/analytics/ui/analytics-root"
import { WishlistSync } from "@/features/wishlist/ui/wishlist-sync-server"
import { PRICE_PENDING_SCRIPT } from "@/lib/display-currency"

export default function StorefrontLayout({ children }: LayoutProps<"/">) {
  return (
    <DisplayCurrencyProvider>
      {/* Before the first paint: see PRICE_PENDING_SCRIPT. */}
      <script dangerouslySetInnerHTML={{ __html: PRICE_PENDING_SCRIPT }} />
      <a
        href="#main"
        className="sr-only z-50 bg-paper px-4 py-2 font-semibold focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
      <Suspense fallback={null}>
        <WishlistSync />
      </Suspense>
      <Suspense fallback={null}>
        <AnalyticsRoot />
      </Suspense>
    </DisplayCurrencyProvider>
  )
}
