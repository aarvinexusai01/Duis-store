import type { Metadata } from "next"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/page-skeleton"
import { requireUser } from "@/features/auth/session-guard"
import { getAccountOverview } from "@/features/customers"
import {
  ConsentForm,
  DeletionRequest,
  ProfileForm,
} from "@/features/customers/ui/profile-forms"

export const metadata: Metadata = { title: "Profile" }

export default function ProfilePage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Profile />
    </Suspense>
  )
}

async function Profile() {
  const actor = await requireUser("/account/profile")
  const account = await getAccountOverview(actor, {})
  return (
    <div className="flex flex-col divide-y">
      <section className="pb-8">
        <h2 className="mb-4 font-display text-2xl tracking-wide uppercase">
          Your details
        </h2>
        <ProfileForm name={account.name} />
        <dl className="mt-6 grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Email</dt>
          <dd>
            {account.email ?? "Not added"}
            {account.email && !account.emailVerified && " (not verified)"}
          </dd>
          <dt className="text-muted-foreground">Mobile</dt>
          <dd>{account.phoneNumber ?? "Not added"}</dd>
        </dl>
      </section>
      <section className="py-8">
        <h2 className="mb-4 font-display text-2xl tracking-wide uppercase">
          Marketing
        </h2>
        <ConsentForm
          marketingEmail={account.marketingEmail}
          marketingWhatsapp={account.marketingWhatsapp}
        />
      </section>
      <section className="pt-8">
        <h2 className="mb-4 font-display text-2xl tracking-wide uppercase">
          Delete account
        </h2>
        <DeletionRequest
          requestedAt={account.deletionRequestedAt?.toISOString() ?? null}
        />
      </section>
    </div>
  )
}
