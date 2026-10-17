import type { Metadata } from "next"

import { SiteFooter } from "@/components/layout/site-footer"
import { SiteHeader } from "@/components/layout/site-header"

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

/**
 * Draft previews (doc/06 Phase 6a): the storefront's own header and footer,
 * but no analytics or consent banner, so previews never count as visits.
 */
export default function PreviewLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </>
  )
}
