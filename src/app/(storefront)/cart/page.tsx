import type { Metadata } from "next"
import Link from "next/link"

import { SHOP_HREF } from "@/config/routes"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/page-skeleton"
import { Button, buttonVariants } from "@/components/ui/button"
import { getCurrentCart } from "@/features/cart/queries"
import { CartLines } from "@/features/cart/ui/cart-lines"
import { CartSummary } from "@/features/cart/ui/cart-summary"
import { cn } from "@/lib/utils"

export const metadata: Metadata = {
  title: "Your bag",
  robots: { index: false, follow: false },
}

export default function CartPage() {
  return (
    <div className="page-container py-8">
      <h1 className="mb-6 display-heading text-5xl sm:text-6xl">Your bag</h1>
      <Suspense fallback={<PageSkeleton />}>
        <Cart />
      </Suspense>
    </div>
  )
}

async function Cart() {
  const cart = await getCurrentCart()
  if (cart.lines.length === 0) {
    return (
      <div className="border border-dashed p-10 text-center">
        <p className="font-semibold">Your bag is empty.</p>
        <Link
          href={SHOP_HREF}
          className={cn(buttonVariants(), "mt-4 h-11 rounded-none px-6")}
        >
          Start shopping
        </Link>
      </div>
    )
  }
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <section aria-label="Items">
        <CartLines lines={cart.lines} />
      </section>
      <aside className="h-fit border bg-card p-6 lg:sticky lg:top-24">
        <h2 className="mb-4 font-display text-2xl tracking-wide uppercase">
          Order summary
        </h2>
        <CartSummary cart={cart} />
        {cart.hasIssues && (
          <p role="alert" className="mt-4 text-sm font-medium text-destructive">
            Some items need your attention before checkout.
          </p>
        )}
        {/* Checkout, payments and orders arrive in Phase 3 (doc/06). */}
        <Button
          disabled
          className="mt-6 h-12 w-full rounded-none text-sm font-semibold tracking-wider uppercase"
        >
          Checkout — coming soon
        </Button>
      </aside>
    </div>
  )
}
