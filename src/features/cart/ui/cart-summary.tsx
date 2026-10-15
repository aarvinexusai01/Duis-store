import { formatPaise } from "@/lib/money"

import type { CartView } from "../service"

/**
 * Totals for the lines that can be bought. Shipping is only "free" when the
 * threshold is met; otherwise the courier's rate is quoted at checkout —
 * never estimated here.
 */
export function CartSummary({ cart }: { cart: CartView }) {
  return (
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between">
        <dt>Total MRP</dt>
        <dd className="tabular-nums">{formatPaise(cart.mrpTotalPaise)}</dd>
      </div>
      {cart.savingsPaise > 0 && (
        <div className="flex justify-between text-rust">
          <dt>You save</dt>
          <dd className="font-semibold tabular-nums">
            −{formatPaise(cart.savingsPaise)}
          </dd>
        </div>
      )}
      <div className="flex justify-between">
        <dt>Shipping</dt>
        <dd>
          {cart.amountToFreeShippingPaise === 0
            ? "Free"
            : "Calculated at checkout"}
        </dd>
      </div>
      <div className="flex justify-between border-t pt-2 text-base font-semibold">
        <dt>Subtotal</dt>
        <dd className="tabular-nums">{formatPaise(cart.subtotalPaise)}</dd>
      </div>
      <p className="text-xs text-muted-foreground">
        Prices include all taxes.
        {cart.amountToFreeShippingPaise > 0 &&
          cart.subtotalPaise > 0 &&
          ` Add ${formatPaise(cart.amountToFreeShippingPaise)} more for free shipping in India.`}
      </p>
    </dl>
  )
}
