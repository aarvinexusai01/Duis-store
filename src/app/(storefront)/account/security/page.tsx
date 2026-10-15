import type { Metadata } from "next"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/page-skeleton"
import { requireUser } from "@/features/auth/session-guard"
import { getAccountOverview } from "@/features/customers"
import {
  ChangePasswordForm,
  SessionList,
} from "@/features/customers/ui/security-panel"

export const metadata: Metadata = { title: "Security" }

export default function SecurityPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Security />
    </Suspense>
  )
}

async function Security() {
  const actor = await requireUser("/account/security")
  const account = await getAccountOverview(actor, {})
  return (
    <div className="flex flex-col divide-y">
      <section className="pb-8">
        <h2 className="mb-4 font-display text-2xl tracking-wide uppercase">
          Password
        </h2>
        {account.hasPassword ? (
          <ChangePasswordForm />
        ) : (
          <p className="text-sm text-muted-foreground">
            You sign in with a one-time code
            {account.phoneNumber ? ` sent to ${account.phoneNumber}` : ""}, so
            there is no password to change.
          </p>
        )}
      </section>
      <section className="pt-8">
        <h2 className="mb-4 font-display text-2xl tracking-wide uppercase">
          Signed-in devices
        </h2>
        <SessionList />
      </section>
    </div>
  )
}
