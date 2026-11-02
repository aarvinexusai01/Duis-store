import type { Metadata } from "next"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/page-skeleton"
import { getPublishedSiteSettings } from "@/features/cms/queries"
import { PrivacyNotice } from "@/features/privacy/ui/privacy-notice"
import { PRIVACY_NOTICE } from "@/lib/privacy-notice"

export const metadata: Metadata = {
  title: PRIVACY_NOTICE.hi.title,
  description: PRIVACY_NOTICE.hi.description,
  alternates: {
    canonical: "/policies/privacy-notice/hi",
    languages: {
      hi: "/policies/privacy-notice/hi",
      en: "/policies/privacy-notice",
    },
  },
}

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Notice />
    </Suspense>
  )
}

async function Notice() {
  return (
    <PrivacyNotice
      language="hi"
      path="/policies/privacy-notice/hi"
      settings={await getPublishedSiteSettings()}
    />
  )
}
