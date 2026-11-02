import type { Metadata, Route } from "next"
import { redirect } from "next/navigation"
import { connection } from "next/server"
import { Suspense } from "react"

import { hasAcceptedAccountNotice } from "@/features/privacy/queries"
import { AccountNoticeForm } from "@/features/privacy/ui/account-notice-form"
import { safeNextPath } from "@/lib/safe-redirect"

export const metadata: Metadata = {
  title: "Your privacy",
  robots: { index: false, follow: false },
}

export default function PrivacyConsentPage({
  searchParams,
}: PageProps<"/privacy-consent">) {
  return (
    <>
      <h1 className="mb-2 display-heading text-5xl">Your privacy</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        India&apos;s data protection law asks us to tell you how we use your
        data and to get your agreement. Please review this once to continue.
      </p>
      <Suspense fallback={null}>
        <Form searchParams={searchParams} />
      </Suspense>
    </>
  )
}

async function Form({
  searchParams,
}: Pick<PageProps<"/privacy-consent">, "searchParams">) {
  await connection()
  const raw = (await searchParams).next
  const next = safeNextPath(typeof raw === "string" ? raw : null)
  const status = await hasAcceptedAccountNotice()
  if (status === "signed_out") {
    redirect(`/login?next=${encodeURIComponent(next)}` as Route)
  }
  if (status === "accepted") redirect(next as Route)
  return <AccountNoticeForm next={next} />
}
