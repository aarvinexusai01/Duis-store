import type { Metadata } from "next"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/page-skeleton"
import { requireUser } from "@/features/auth/session-guard"
import { listAddresses } from "@/features/customers"
import { AddressBook } from "@/features/customers/ui/address-book"

export const metadata: Metadata = { title: "Addresses" }

export default function AddressesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Addresses />
    </Suspense>
  )
}

async function Addresses() {
  const actor = await requireUser("/account/addresses")
  return (
    <section>
      <h2 className="mb-4 font-display text-2xl tracking-wide uppercase">
        Addresses
      </h2>
      <AddressBook addresses={await listAddresses(actor, {})} />
    </section>
  )
}
