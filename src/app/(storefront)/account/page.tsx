import type { Route } from "next"
import Link from "next/link"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/page-skeleton"
import { requireUser } from "@/features/auth/session-guard"
import { getAccountOverview } from "@/features/customers"
import { SignOutButton } from "@/features/customers/ui/security-panel"

export default function AccountPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Overview />
    </Suspense>
  )
}

async function Overview() {
  const actor = await requireUser("/account")
  const account = await getAccountOverview(actor, {})
  const cards: { href: Route; title: string; body: string }[] = [
    {
      href: "/account/profile",
      title: "Profile",
      body: "Name, contact details and marketing preferences.",
    },
    {
      href: "/account/addresses",
      title: "Addresses",
      body: "Where we deliver your orders.",
    },
    {
      href: "/account/security",
      title: "Security",
      body: "Password and signed-in devices.",
    },
    {
      href: "/wishlist",
      title: "Wishlist",
      body: "Products you saved for later.",
    },
  ]
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-lg">
          Hi, <strong>{account.name}</strong>
        </p>
        <SignOutButton />
      </div>
      <section className="border border-dashed p-6">
        <h2 className="font-display text-2xl tracking-wide uppercase">
          Orders
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You haven&apos;t placed any orders yet.
        </p>
      </section>
      <ul className="grid gap-4 sm:grid-cols-2">
        {cards.map((card) => (
          <li key={card.href}>
            <Link
              href={card.href}
              className="block h-full border bg-card p-5 hover:border-ink"
            >
              <h2 className="font-display text-2xl tracking-wide uppercase">
                {card.title}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{card.body}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
