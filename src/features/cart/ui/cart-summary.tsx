"use client"

import { useMoney } from "@/components/brand/display-currency"

import type { CartView } from "../service"

/**
 * Totals for the lines that can be bought. Shipping is only "free" when the
 * threshold is met; otherwise the courier's rate is quoted at checkout —
 * never estimated here.
 *
 * In dollars (doc/06 Phase 13d), each line's price is converted and then
 * added up, as checkout does; there is no free shipping abroad.
 */
export function CartSummary({ cart }: { cart: CartView }) {
  const money = useMoney()
  const buyable = cart.lines.filter((line) => line.issue === null)
  const sum = (price: (line: CartView["lines"][number]) => number) =>
    buyable.reduce(
      (total, line) => total + money.toMinor(price(line)) * line.quantity,
      0,
    )
  const subtotal = money.usd ? sum((l) => l.unitPricePaise) : cart.subtotalPaise
  const mrpTotal = money.usd ? sum((l) => l.unitMrpPaise) : cart.mrpTotalPaise
  const savings = mrpTotal - subtotal
  const freeShipping = !money.usd && cart.amountToFreeShippingPaise === 0
  return (
    <dl data-price className="space-y-2 text-sm">
      <div className="flex justify-between">
        <dt>Total MRP</dt>
        <dd className="tabular-nums">{money.formatMinor(mrpTotal)}</dd>
      </div>
      {savings > 0 && (
        <div className="flex justify-between text-rust">
          <dt>You save</dt>
          <dd className="font-semibold tabular-nums">
            −{money.formatMinor(savings)}
          </dd>
        </div>
      )}
      <div className="flex justify-between">
        <dt>Shipping</dt>
        <dd>{freeShipping ? "Free" : "Calculated at checkout"}</dd>
      </div>
      <div className="flex justify-between border-t pt-2 text-base font-semibold">
        <dt>Subtotal</dt>
        <dd className="tabular-nums">{money.formatMinor(subtotal)}</dd>
      </div>
      <p className="text-xs text-muted-foreground">
        {money.usd ? (
          "Shown in US dollars. Your delivery country sets the final price at checkout."
        ) : (
          <>
            Prices include all taxes.
            {cart.amountToFreeShippingPaise > 0 &&
              cart.subtotalPaise > 0 &&
              ` Add ${money.formatMinor(cart.amountToFreeShippingPaise)} more for free shipping in India.`}
          </>
        )}
      </p>
    </dl>
  )
}
