import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/page-skeleton"
import { buttonVariants } from "@/components/ui/button"
import { getServerEnv } from "@/config/env"
import { SHOP_HREF } from "@/config/routes"
import { requireUser } from "@/features/auth/session-guard"
import { getCurrentCart } from "@/features/cart/queries"
import { getCheckoutQuote, type CheckoutChoices } from "@/features/checkout"
import { getAccountOverview, listAddresses } from "@/features/customers"
import { cn } from "@/lib/utils"

import { TrackEvent } from "@/features/analytics/ui/track-event"

import { CheckoutForm } from "./_components/checkout-form"

export const metadata: Metadata = { title: "Checkout" }

export default function CheckoutPage() {
  return (
    <>
      <h1 className="mb-8 display-heading text-5xl sm:text-6xl">Checkout</h1>
      <Suspense fallback={<PageSkeleton />}>
        <Checkout />
      </Suspense>
    </>
  )
}

async function Checkout() {
  const actor = await requireUser("/checkout")
  const [cart, addresses] = await Promise.all([
    getCurrentCart(),
    listAddresses(actor, {}),
  ])
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
  const defaultAddress = addresses.find((a) => a.isDefault) ?? addresses[0]
  const choices: CheckoutChoices | null = defaultAddress
    ? {
        addressId: defaultAddress.id,
        paymentMode: "prepaid",
        useWallet: false,
        couponCode: null,
      }
    : null
  const [initial, account] = await Promise.all([
    choices ? getCheckoutQuote(actor, choices) : null,
    getAccountOverview(actor, {}),
  ])
  return (
    <>
      <TrackEvent
        event={{
          name: "begin_checkout",
          valuePaise: cart.subtotalPaise,
          items: cart.lines.map((line) => ({
            id: line.productId,
            name: line.title,
            variant: line.sku,
            pricePaise: line.unitPricePaise,
            quantity: line.quantity,
          })),
        }}
      />
      <CheckoutForm
        addresses={addresses}
        initial={initial}
        initialChoices={choices}
        whatsapp={{
          offered: getServerEnv().WHATSAPP_PROVIDER !== "off",
          enabled: account.whatsappUpdates,
        }}
      />
    </>
  )
}
