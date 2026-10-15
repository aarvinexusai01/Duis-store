import type { Metadata } from "next"
import Link from "next/link"

import { SHOP_HREF } from "@/config/routes"
import { redirect } from "next/navigation"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/page-skeleton"
import { ProductGrid } from "@/components/product/product-card"
import { buttonVariants } from "@/components/ui/button"
import { getProductCards } from "@/features/catalog/queries"
import { listWishlist } from "@/features/wishlist"
import { cn } from "@/lib/utils"
import { getActor } from "@/server/auth/session"

export const metadata: Metadata = {
  title: "Wishlist",
  robots: { index: false, follow: false },
}

export default function WishlistPage() {
  return (
    <div className="page-container py-8">
      <h1 className="mb-6 display-heading text-5xl sm:text-6xl">Wishlist</h1>
      <Suspense fallback={<PageSkeleton variant="grid" />}>
        <Saved />
      </Suspense>
    </div>
  )
}

async function Saved() {
  const actor = await getActor()
  if (actor.kind !== "user") redirect("/login?next=/wishlist")
  const products = await getProductCards(await listWishlist(actor, {}))
  if (products.length === 0) {
    return (
      <div className="border border-dashed p-10 text-center">
        <p className="font-semibold">Nothing saved yet.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Tap the heart on any product to keep it here.
        </p>
        <Link
          href={SHOP_HREF}
          className={cn(buttonVariants(), "mt-4 h-11 rounded-none px-6")}
        >
          Browse the shop
        </Link>
      </div>
    )
  }
  return <ProductGrid products={products} />
}
