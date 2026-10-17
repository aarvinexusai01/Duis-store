import { Suspense } from "react"

import { PageSkeleton } from "@/components/page-skeleton"
import { getServerEnv } from "@/config/env"
import { CmsPageView, cmsPageMetadata } from "@/features/cms/ui/cms-page"
import { ContactForm } from "@/features/contact/ui/contact-form"

export function generateMetadata() {
  return cmsPageMetadata("contact")
}

export default function Page() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CmsPageView slug="contact" path="/contact">
        <ContactSection />
      </CmsPageView>
    </Suspense>
  )
}

/** Rendered inside the page view, after its connection(): env is per request. */
function ContactSection() {
  return (
    <ContactForm turnstileSiteKey={getServerEnv().TURNSTILE_SITE_KEY ?? null} />
  )
}
