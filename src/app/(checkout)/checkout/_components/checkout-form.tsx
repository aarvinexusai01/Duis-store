"use client"

import { LockIcon, PlusIcon, TagIcon } from "lucide-react"
import type { Route } from "next"
import { useRouter } from "next/navigation"
import { useMemo, useRef, useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import type { Address } from "@/features/customers"
import { AddressForm } from "@/features/customers/ui/address-book"
import { countryName } from "@/lib/countries"
import { INDIAN_STATES } from "@/lib/india"
import { formatPaise } from "@/lib/money"
import { cn } from "@/lib/utils"

import { placeOrderAction, quoteAction } from "@/features/checkout/actions"
import type { CheckoutChoices, CheckoutView } from "@/features/checkout"
import { usePayment } from "@/components/payment/use-payment"

export function CheckoutForm({
  addresses,
  initial,
  initialChoices,
}: {
  addresses: Address[]
  initial: CheckoutView | null
  initialChoices: CheckoutChoices | null
}) {
  const router = useRouter()
  const [view, setView] = useState(initial)
  const [choices, setChoices] = useState<CheckoutChoices | null>(initialChoices)
  const [couponInput, setCouponInput] = useState(
    initialChoices?.couponCode ?? "",
  )
  const [adding, setAdding] = useState(addresses.length === 0)
  // A saved address arrives as new server props: adopt its fresh quote.
  const [seenAddresses, setSeenAddresses] = useState(addresses)
  if (addresses !== seenAddresses) {
    setSeenAddresses(addresses)
    if (initialChoices && initial) {
      setChoices((current) => current ?? initialChoices)
      setView((current) => current ?? initial)
      setAdding(false)
    }
  }
  const [error, setError] = useState("")
  const [pending, startTransition] = useTransition()
  const [placing, setPlacing] = useState(false)
  // One key per attempt: a double click or retry can never create two orders.
  const attemptKey = useRef(crypto.randomUUID())
  const { pay, dialog } = usePayment()

  const update = (next: Partial<CheckoutChoices>) => {
    if (!choices) return
    const merged = { ...choices, ...next }
    setChoices(merged)
    setError("")
    startTransition(async () => {
      const result = await quoteAction(merged)
      if (result.ok) setView(result.view)
      else setError(result.message)
    })
  }

  const blocking = useMemo(
    () => view?.quote.issues.filter((i) => i.blocking) ?? [],
    [view],
  )
  const notices = useMemo(
    () => view?.quote.issues.filter((i) => !i.blocking) ?? [],
    [view],
  )

  const placeAndPay = async () => {
    if (!view || !choices) return
    setPlacing(true)
    setError("")
    try {
      const placed = await placeOrderAction({
        ...choices,
        quoteHash: view.hash,
        idempotencyKey: attemptKey.current,
      })
      if (!placed.ok) {
        if (placed.quote) setView(placed.quote)
        setError(placed.message)
        return
      }
      const result = placed.result
      const success = `/checkout/success/${result.orderNumber}` as Route
      if (result.status === "confirmed") {
        router.push(success)
        return
      }
      const outcome = await pay(result.payment)
      if (outcome === "confirmed" || outcome === "pending") {
        router.push(success)
      } else if (outcome === "cancelled") {
        toast.error(
          "The items sold out while you paid. Your payment is being refunded.",
        )
        router.push(`/account/orders/${result.orderNumber}` as Route)
      } else {
        // The order is placed and its stock held: pay from the order page.
        toast.error(
          outcome === "failed"
            ? "The payment didn't go through. You can try again."
            : "Payment not completed. You can pay from your order page.",
        )
        router.push(`/account/orders/${result.orderNumber}` as Route)
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Something went wrong. Please try again.",
      )
    } finally {
      setPlacing(false)
    }
  }

  if (adding || !choices || !view) {
    return (
      <section className="max-w-2xl">
        <h2 className="mb-4 font-display text-2xl tracking-wide uppercase">
          Delivery address
        </h2>
        <AddressForm
          address={null}
          canCancel={addresses.length > 0}
          onDone={(savedId) => {
            setAdding(false)
            if (!savedId) return
            // Quote the new address straight away; the list refreshes alongside.
            const next: CheckoutChoices = {
              paymentMode: "prepaid",
              useWallet: false,
              couponCode: null,
              ...choices,
              addressId: savedId,
            }
            setChoices(next)
            startTransition(async () => {
              const result = await quoteAction(next)
              if (result.ok) setView(result.view)
              else setError(result.message)
            })
          }}
        />
      </section>
    )
  }

  const q = view.quote
  const intl = q.isExport

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex flex-col gap-10">
        <section aria-labelledby="checkout-address">
          <h2
            id="checkout-address"
            className="mb-4 font-display text-2xl tracking-wide uppercase"
          >
            Delivery address
          </h2>
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">Choose a delivery address</legend>
            {addresses.map((address) => (
              <label
                key={address.id}
                className={cn(
                  "flex cursor-pointer gap-3 border bg-card p-4 text-sm",
                  choices.addressId === address.id &&
                    "border-ink ring-1 ring-ink",
                )}
              >
                <input
                  type="radio"
                  name="address"
                  checked={choices.addressId === address.id}
                  onChange={() => update({ addressId: address.id })}
                  className="mt-1 accent-ink"
                />
                <span>
                  <span className="font-semibold">{address.fullName}</span>
                  <br />
                  {[address.line1, address.line2].filter(Boolean).join(", ")}
                  <br />
                  {address.city},{" "}
                  {address.countryCode === "IN"
                    ? INDIAN_STATES.find(
                        ([code]) => code === address.stateCode,
                      )?.[1]
                    : address.region}{" "}
                  {address.postalCode}
                  <br />
                  {countryName(address.countryCode)} · {address.phone}
                </span>
              </label>
            ))}
          </fieldset>
          <Button
            variant="outline"
            className="mt-3 h-10 rounded-none"
            onClick={() => setAdding(true)}
          >
            <PlusIcon /> Add a new address
          </Button>
        </section>

        <section aria-labelledby="checkout-payment">
          <h2
            id="checkout-payment"
            className="mb-4 font-display text-2xl tracking-wide uppercase"
          >
            Payment
          </h2>
          <fieldset className="flex flex-col gap-3">
            <legend className="sr-only">Choose how to pay</legend>
            <PaymentChoice
              checked={choices.paymentMode === "prepaid"}
              onSelect={() => update({ paymentMode: "prepaid" })}
              title="Pay online"
              body={
                intl
                  ? "International cards, charged in INR."
                  : "UPI, cards, net banking or wallets through Razorpay."
              }
            />
            <PaymentChoice
              checked={choices.paymentMode === "partial_cod"}
              disabled={!view.codAvailable}
              onSelect={() => update({ paymentMode: "partial_cod" })}
              title="Cash on delivery"
              body={
                view.codAvailable
                  ? "Pay a small advance online now and the rest in cash when it arrives. The advance is not refunded if the parcel is refused at delivery."
                  : (view.codReason ?? "Not available for this order.")
              }
            />
          </fieldset>

          {view.walletBalancePaise > 0 && (
            <label className="mt-5 flex items-center justify-between gap-4 border bg-card p-4 text-sm">
              <span>
                Use wallet balance{" "}
                <strong>{formatPaise(view.walletBalancePaise)}</strong>
              </span>
              <Switch
                checked={choices.useWallet}
                onCheckedChange={(on) => update({ useWallet: on })}
              />
            </label>
          )}

          <form
            className="mt-5 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              update({ couponCode: couponInput.trim() || null })
            }}
          >
            <label htmlFor="coupon" className="sr-only">
              Coupon code
            </label>
            <div className="relative flex-1">
              <TagIcon
                aria-hidden
                className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                id="coupon"
                value={couponInput}
                onChange={(event) =>
                  setCouponInput(event.target.value.toUpperCase())
                }
                placeholder="Coupon code"
                maxLength={32}
                className="h-11 w-full border border-input bg-card pr-3 pl-9 text-sm uppercase"
              />
            </div>
            {q.couponCode ? (
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-none"
                onClick={() => {
                  setCouponInput("")
                  update({ couponCode: null })
                }}
              >
                Remove
              </Button>
            ) : (
              <Button
                type="submit"
                variant="outline"
                className="h-11 rounded-none"
                disabled={!couponInput.trim()}
              >
                Apply
              </Button>
            )}
          </form>
          {notices.map((notice) => (
            <p
              key={notice.message}
              className="mt-2 text-sm text-muted-foreground"
              role="status"
            >
              {notice.message}
            </p>
          ))}
        </section>
      </div>

      <aside
        className="h-fit border bg-card p-6 lg:sticky lg:top-6"
        aria-labelledby="checkout-summary"
        aria-busy={pending}
      >
        <h2
          id="checkout-summary"
          className="mb-4 font-display text-2xl tracking-wide uppercase"
        >
          Order summary
        </h2>
        <ul className="mb-4 space-y-2 text-sm">
          {q.lines.map((line) => (
            <li key={line.variantId} className="flex justify-between gap-3">
              <span className="min-w-0">
                <span className="line-clamp-1">{line.title}</span>
                <span className="text-xs text-muted-foreground">
                  {line.variantLabel} × {line.quantity}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">
                {formatPaise(line.subtotalPaise)}
              </span>
            </li>
          ))}
        </ul>
        <dl
          className={cn(
            "space-y-2 border-t pt-4 text-sm",
            pending && "opacity-60",
          )}
        >
          <Row label="Subtotal" value={formatPaise(q.subtotalPaise)} />
          {q.discounts.map((d) => (
            <Row
              key={d.label}
              label={d.label}
              value={`−${formatPaise(d.amountPaise)}`}
              className="text-rust"
            />
          ))}
          <Row
            label="Shipping"
            value={
              q.shippingFeePaise === 0
                ? "Free"
                : formatPaise(q.shippingFeePaise)
            }
          />
          {q.codFeePaise > 0 && (
            <Row label="COD fee" value={formatPaise(q.codFeePaise)} />
          )}
          <Row
            label="Total"
            value={formatPaise(q.totalPaise)}
            className="border-t pt-2 text-base font-semibold"
          />
          {q.walletAppliedPaise > 0 && (
            <Row
              label="Paid from wallet"
              value={`−${formatPaise(q.walletAppliedPaise)}`}
            />
          )}
          <Row
            label="Pay now"
            value={formatPaise(q.onlineAmountPaise)}
            className="font-semibold"
          />
          {q.codDuePaise > 0 && (
            <Row
              label="Pay in cash on delivery"
              value={formatPaise(q.codDuePaise)}
            />
          )}
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          {intl
            ? "Exported without Indian GST. Import duties and taxes, if any, are charged by your country's customs on delivery and paid by you."
            : `Prices include GST (${formatPaise(q.taxTotalPaise)}).`}
        </p>

        {blocking.length > 0 && (
          <ul
            role="alert"
            className="mt-4 space-y-1 text-sm font-medium text-destructive"
          >
            {blocking.map((issue) => (
              <li key={issue.message}>{issue.message}</li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="mt-4 text-sm font-medium text-destructive">
            {error}
          </p>
        )}
        <Button
          onClick={placeAndPay}
          disabled={placing || pending || blocking.length > 0}
          className="mt-6 h-12 w-full rounded-none text-sm font-semibold tracking-wider uppercase"
        >
          <LockIcon />
          {placing
            ? "Processing…"
            : q.onlineAmountPaise === 0
              ? "Place order"
              : `Place order & pay ${formatPaise(q.onlineAmountPaise)}`}
        </Button>
        <p className="mt-3 text-xs text-muted-foreground">
          Items are held for {view.reservationMinutes} minutes while you pay. By
          placing the order you agree to our terms, shipping and exchange
          policies.
        </p>
      </aside>
      {dialog}
    </div>
  )
}

function PaymentChoice({
  checked,
  disabled = false,
  onSelect,
  title,
  body,
}: {
  checked: boolean
  disabled?: boolean
  onSelect: () => void
  title: string
  body: string
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-3 border bg-card p-4 text-sm",
        checked && "border-ink ring-1 ring-ink",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        type="radio"
        name="payment"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="mt-1 accent-ink"
      />
      <span>
        <span className="font-semibold">{title}</span>
        <br />
        <span className="text-muted-foreground">{body}</span>
      </span>
    </label>
  )
}

function Row({
  label,
  value,
  className,
}: {
  label: string
  value: string
  className?: string
}) {
  return (
    <div className={cn("flex justify-between gap-3", className)}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  )
}
