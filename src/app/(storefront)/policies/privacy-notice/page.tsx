import type { Metadata } from "next"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/page-skeleton"
import { getPublishedSiteSettings } from "@/features/cms/queries"
import { PrivacyNotice } from "@/features/privacy/ui/privacy-notice"
import { PRIVACY_NOTICE } from "@/lib/privacy-notice"

export const metadata: Metadata = {
  title: PRIVACY_NOTICE.en.title,
  description: PRIVACY_NOTICE.en.description,
  alternates: {
    canonical: "/policies/privacy-notice",
    languages: {
      en: "/policies/privacy-notice",
      hi: "/policies/privacy-notice/hi",
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
      language="en"
      path="/policies/privacy-notice"
      settings={await getPublishedSiteSettings()}
    />
  )
}
