"use client"

import Link from "next/link"

import { Button } from "@/components/ui/button"

/**
 * Unexpected failures during checkout, inside the secure-checkout layout.
 * The bag is untouched, and no payment is taken without a confirmed order.
 */
export default function CheckoutError({ retry }: { retry: () => void }) {
  return (
    <div className="flex max-w-xl flex-col items-start gap-4 py-12">
      <h1 className="display-heading text-4xl">Checkout didn&apos;t load</h1>
      <p className="text-muted-foreground">
        Your bag is safe, and you haven&apos;t been charged. Please try again.
      </p>
      <div className="flex gap-3">
        <Button onClick={() => retry()} className="h-11 rounded-none px-6">
          Try again
        </Button>
        <Button
          variant="outline"
          className="h-11 rounded-none px-6"
          render={<Link href="/cart" />}
        >
          Back to bag
        </Button>
      </div>
    </div>
  )
}
