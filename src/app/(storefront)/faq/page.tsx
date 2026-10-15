import { Suspense } from "react"

import { PageSkeleton } from "@/components/page-skeleton"
import { CmsPageView, cmsPageMetadata } from "@/features/cms/ui/cms-page"

export function generateMetadata() {
  return cmsPageMetadata("faq")
}

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CmsPageView slug="faq" path="/faq" />
    </Suspense>
  )
}
