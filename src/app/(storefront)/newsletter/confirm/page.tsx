import type { Metadata } from "next"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/page-skeleton"
import { ConfirmSubscription } from "@/features/marketing/ui/confirm-subscription"

export const metadata: Metadata = {
  title: "Confirm your subscription",
  robots: { index: false, follow: false },
}

/**
 * The emailed link only opens this page; confirming takes a click, so link
 * scanners that prefetch URLs cannot subscribe anyone.
 */
export default function Page({
  searchParams,
}: PageProps<"/newsletter/confirm">) {
  return (
    <div className="page-container max-w-xl py-16">
      <h1 className="display-heading text-5xl">Confirm subscription</h1>
      <Suspense fallback={<PageSkeleton />}>
        <Token searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Token({
  searchParams,
}: Pick<PageProps<"/newsletter/confirm">, "searchParams">) {
  const token = (await searchParams).token
  return <ConfirmSubscription token={typeof token === "string" ? token : ""} />
}
