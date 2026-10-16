"use client"

import { useState, useTransition, type ReactNode } from "react"
import { toast } from "sonner"

import { StatusBadge } from "@/components/admin/page-header"
import { Button } from "@/components/ui/button"
import type { AdminSettings, IntegrationStatus } from "@/features/settings"
import {
  addTaxRuleAction,
  testIntegrationAction,
  updateCodSettingsAction,
  updateLegalSettingsAction,
  updateNotificationSettingsAction,
  updatePolicySettingsAction,
  updateShippingSettingsAction,
} from "@/features/settings/admin-actions"
import { COUNTRY_NAMES } from "@/lib/countries"
import { INDIAN_STATES } from "@/lib/india"

const field =
  "h-9 w-full rounded-sm border border-input bg-paper px-2 text-sm disabled:opacity-70"
type Errors = Record<string, string[] | undefined>
type Result = { ok: boolean; message?: string; fieldErrors?: Errors }

/** A settings section: a card with its own form and Save button. */
function Section({
  id,
  title,
  description,
  canEdit,
  onSubmit,
  children,
}: {
  id: string
  title: string
  description?: string
  canEdit: boolean
  onSubmit: (form: FormData) => Promise<Result>
  children: (errors: Errors) => ReactNode
}) {
  const [errors, setErrors] = useState<Errors>({})
  const [pending, startTransition] = useTransition()
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    startTransition(async () => {
      const result = await onSubmit(form)
      if (result.ok) {
        setErrors({})
        toast.success(`${title} saved`)
      } else {
        setErrors(result.fieldErrors ?? {})
        toast.error(result.message ?? "Couldn't save.")
      }
    })
  }
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-20 rounded-sm border bg-card p-4"
    >
      <h2 id={`${id}-title`} className="font-semibold">
        {title}
      </h2>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      )}
      <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
        <fieldset disabled={!canEdit} className="contents">
          {children(errors)}
        </fieldset>
        {canEdit && (
          <Button
            type="submit"
            disabled={pending}
            className="self-start rounded-sm"
          >
            {pending ? "Saving…" : "Save"}
          </Button>
        )}
      </form>
    </section>
  )
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string[]
  children: ReactNode
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      {error && <span className="text-xs text-destructive">{error[0]}</span>}
    </label>
  )
}

const text = (form: FormData, name: string) => String(form.get(name) ?? "")
const rupeesToPaise = (form: FormData, name: string) =>
  Math.round(Number(text(form, name)) * 100)
const int = (form: FormData, name: string) => Number(text(form, name))
const checked = (form: FormData, name: string) => form.get(name) === "on"

type Props = { settings: AdminSettings; canEdit: boolean }

export function LegalForm({ settings, canEdit }: Props) {
  return (
    <Section
      id="legal"
      title="Store & legal"
      description="Used on GST exports and by the invoicing tool. The registered state decides CGST + SGST (same state) or IGST."
      canEdit={canEdit}
      onSubmit={(form) =>
        updateLegalSettingsAction({
          legalName: text(form, "legalName"),
          gstin: text(form, "gstin"),
          registeredStateCode: text(form, "registeredStateCode"),
          iecCode: text(form, "iecCode"),
          lutReference: text(form, "lutReference"),
        })
      }
    >
      {(errors) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Legal name" error={errors.legalName}>
            <input
              name="legalName"
              defaultValue={settings.legalName ?? ""}
              className={field}
            />
          </Field>
          <Field label="GSTIN" error={errors.gstin}>
            <input
              name="gstin"
              defaultValue={settings.gstin ?? ""}
              maxLength={15}
              className={`${field} font-mono uppercase`}
            />
          </Field>
          <Field label="Registered state" error={errors.registeredStateCode}>
            <select
              name="registeredStateCode"
              defaultValue={settings.registeredStateCode}
              className={field}
            >
              {INDIAN_STATES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="IEC (exports)" error={errors.iecCode}>
            <input
              name="iecCode"
              defaultValue={settings.iecCode ?? ""}
              maxLength={10}
              className={`${field} font-mono uppercase`}
            />
          </Field>
          <Field
            label="LUT reference (zero-rated exports)"
            error={errors.lutReference}
          >
            <input
              name="lutReference"
              defaultValue={settings.lutReference ?? ""}
              className={field}
            />
          </Field>
        </div>
      )}
    </Section>
  )
}

export function ShippingForm({ settings, canEdit }: Props) {
  const [countries, setCountries] = useState(
    new Set(settings.internationalCountryCodes),
  )
  return (
    <Section
      id="shipping"
      title="Shipping"
      description="Below the threshold, the courier's live rate for the PIN code and weight is charged."
      canEdit={canEdit}
      onSubmit={(form) =>
        updateShippingSettingsAction({
          freeShippingThresholdPaise: rupeesToPaise(form, "threshold"),
          internationalCountryCodes: [...countries],
        })
      }
    >
      {(errors) => (
        <>
          <Field
            label="Free shipping in India from (₹)"
            error={errors.freeShippingThresholdPaise}
          >
            <input
              name="threshold"
              type="number"
              min={0}
              step="1"
              required
              defaultValue={settings.freeShippingThresholdPaise / 100}
              className={`${field} max-w-48`}
            />
          </Field>
          <details className="rounded-sm border p-3 text-sm">
            <summary className="cursor-pointer">
              International destinations ({countries.size}): prepaid only
            </summary>
            <div className="mt-3 grid max-h-72 gap-1 overflow-y-auto sm:grid-cols-3">
              {Object.entries(COUNTRY_NAMES)
                .filter(([code]) => code !== "IN")
                .sort((a, b) => a[1].localeCompare(b[1]))
                .map(([code, name]) => (
                  <label key={code} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={countries.has(code)}
                      onChange={() =>
                        setCountries((current) => {
                          const next = new Set(current)
                          if (next.has(code)) next.delete(code)
                          else next.add(code)
                          return next
                        })
                      }
                    />
                    {name}
                  </label>
                ))}
            </div>
          </details>
        </>
      )}
    </Section>
  )
}

export function CodForm({ settings, canEdit }: Props) {
  const [type, setType] = useState(settings.codAdvanceType)
  return (
    <Section
      id="cod"
      title="Cash on delivery"
      description="Partial COD: the customer pays an advance online and the rest in cash."
      canEdit={canEdit}
      onSubmit={(form) =>
        updateCodSettingsAction({
          partialCodEnabled: checked(form, "enabled"),
          codAdvanceType: type,
          // ₹ → paise, or % → basis points: both ×100.
          codAdvanceValue: Math.round(Number(text(form, "advance")) * 100),
          codMaxOrderPaise: rupeesToPaise(form, "max"),
          codFeePaise: rupeesToPaise(form, "fee"),
          rtoAdvancePolicy: text(
            form,
            "rto",
          ) as AdminSettings["rtoAdvancePolicy"],
        })
      }
    >
      {(errors) => (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={settings.partialCodEnabled}
            />
            Offer partial cash on delivery
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={
                type === "fixed" ? "Advance (₹)" : "Advance (% of the order)"
              }
              error={errors.codAdvanceValue}
            >
              <span className="flex gap-2">
                <select
                  aria-label="Advance type"
                  value={type}
                  onChange={(e) =>
                    setType(e.target.value as AdminSettings["codAdvanceType"])
                  }
                  className={`${field} w-28`}
                >
                  <option value="fixed">₹ fixed</option>
                  <option value="percent">% of order</option>
                </select>
                <input
                  name="advance"
                  type="number"
                  min={1}
                  step="1"
                  required
                  key={type}
                  defaultValue={
                    type === settings.codAdvanceType
                      ? settings.codAdvanceValue / 100
                      : undefined
                  }
                  className={field}
                />
              </span>
            </Field>
            <Field
              label="Highest order for COD (₹)"
              error={errors.codMaxOrderPaise}
            >
              <input
                name="max"
                type="number"
                min={0}
                step="1"
                required
                defaultValue={settings.codMaxOrderPaise / 100}
                className={field}
              />
            </Field>
            <Field label="COD fee (₹)" error={errors.codFeePaise}>
              <input
                name="fee"
                type="number"
                min={0}
                step="1"
                required
                defaultValue={settings.codFeePaise / 100}
                className={field}
              />
            </Field>
            <Field
              label="If a COD parcel is refused (RTO), the advance is…"
              error={errors.rtoAdvancePolicy}
            >
              <select
                name="rto"
                defaultValue={settings.rtoAdvancePolicy}
                className={field}
              >
                <option value="keep">Kept (covers the courier cost)</option>
                <option value="wallet">Credited to the wallet</option>
                <option value="refund">Refunded to the payment</option>
              </select>
            </Field>
          </div>
        </>
      )}
    </Section>
  )
}

export function PoliciesForm({ settings, canEdit }: Props) {
  return (
    <Section
      id="policies"
      title="Policies"
      canEdit={canEdit}
      onSubmit={(form) =>
        updatePolicySettingsAction({
          exchangeWindowDays: int(form, "window"),
          maxExchangesPerItem: int(form, "exchanges"),
          reservationTtlMinutes: int(form, "hold"),
          promoCreditValidityDays: int(form, "promo"),
        })
      }
    >
      {(errors) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Exchange window (days after delivery)"
            hint="0 turns exchanges off on product pages."
            error={errors.exchangeWindowDays}
          >
            <input
              name="window"
              type="number"
              min={0}
              max={60}
              required
              defaultValue={settings.exchangeWindowDays}
              className={field}
            />
          </Field>
          <Field label="Exchanges per item" error={errors.maxExchangesPerItem}>
            <input
              name="exchanges"
              type="number"
              min={0}
              max={5}
              required
              defaultValue={settings.maxExchangesPerItem}
              className={field}
            />
          </Field>
          <Field
            label="Hold stock while paying (minutes)"
            hint="Unpaid orders release their stock after this."
            error={errors.reservationTtlMinutes}
          >
            <input
              name="hold"
              type="number"
              min={5}
              max={60}
              required
              defaultValue={settings.reservationTtlMinutes}
              className={field}
            />
          </Field>
          <Field
            label="Promotional credit lasts (days)"
            hint="Refunds to the wallet never expire."
            error={errors.promoCreditValidityDays}
          >
            <input
              name="promo"
              type="number"
              min={1}
              max={365}
              required
              defaultValue={settings.promoCreditValidityDays}
              className={field}
            />
          </Field>
        </div>
      )}
    </Section>
  )
}

export function NotificationsForm({ settings, canEdit }: Props) {
  return (
    <Section
      id="notifications"
      title="Emails"
      description="Order confirmations, cancellations, refunds and account emails are always sent. The wording is fixed in the app."
      canEdit={canEdit}
      onSubmit={(form) =>
        updateNotificationSettingsAction({
          emailSenderName: text(form, "sender"),
          emailReplyTo: text(form, "replyTo"),
          notifyOrderShipped: checked(form, "shipped"),
          notifyPaymentReminder: checked(form, "reminder"),
          notifyLowStock: checked(form, "lowStock"),
        })
      }
    >
      {(errors) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Sender name" error={errors.emailSenderName}>
              <input
                name="sender"
                required
                maxLength={60}
                defaultValue={settings.emailSenderName}
                className={field}
              />
            </Field>
            <Field
              label="Replies go to (optional)"
              hint="Customers who reply to an email reach this address."
              error={errors.emailReplyTo}
            >
              <input
                name="replyTo"
                type="email"
                defaultValue={settings.emailReplyTo ?? ""}
                className={field}
              />
            </Field>
          </div>
          <fieldset className="flex flex-col gap-1.5 text-sm">
            <legend className="mb-1 font-medium">Optional emails</legend>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="shipped"
                defaultChecked={settings.notifyOrderShipped}
              />
              Order shipped (courier and tracking number)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="reminder"
                defaultChecked={settings.notifyPaymentReminder}
              />
              Payment not completed (sent when an unpaid order expires)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                name="lowStock"
                defaultChecked={settings.notifyLowStock}
              />
              Daily low-stock summary to Store and Super Admins (09:00 IST)
            </label>
          </fieldset>
        </>
      )}
    </Section>
  )
}

export function TaxRules({
  rules,
  canEdit,
}: {
  rules: AdminSettings["taxRules"]
  canEdit: boolean
}) {
  return (
    <section
      id="tax"
      aria-labelledby="tax-title"
      className="scroll-mt-20 rounded-sm border bg-card p-4"
    >
      <h2 id="tax-title" className="font-semibold">
        Tax rules (GST by HSN)
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        The lower rate applies while the price per piece before tax is at or
        below the threshold. A new rule starts on a date and ends the previous
        one; past orders keep their tax. Confirm rates with your CA.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground uppercase">
            <tr>
              <th className="py-2 pr-3 font-medium">HSN</th>
              <th className="py-2 pr-3 font-medium">Up to</th>
              <th className="py-2 pr-3 font-medium">Rate</th>
              <th className="py-2 pr-3 font-medium">Above</th>
              <th className="py-2 font-medium">In force</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rules.map((rule) => (
              <tr key={rule.id}>
                <td className="py-2 pr-3 font-mono">{rule.hsnPrefix}</td>
                <td className="py-2 pr-3 tabular-nums">
                  {rule.priceThresholdPaise === null
                    ? "—"
                    : `₹${(rule.priceThresholdPaise / 100).toLocaleString("en-IN")}`}
                </td>
                <td className="py-2 pr-3">{rule.rateBelowBp / 100}%</td>
                <td className="py-2 pr-3">{rule.rateAboveBp / 100}%</td>
                <td className="py-2 whitespace-nowrap">
                  {rule.effectiveFrom} → {rule.effectiveTo ?? "now"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit && <AddTaxRule />}
    </section>
  )
}

function AddTaxRule() {
  const [errors, setErrors] = useState<Errors>({})
  const [pending, startTransition] = useTransition()
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    startTransition(async () => {
      const threshold = text(form, "threshold")
      const result = await addTaxRuleAction({
        hsnPrefix: text(form, "hsn"),
        priceThresholdPaise: threshold
          ? Math.round(Number(threshold) * 100)
          : null,
        rateBelowBp: Math.round(Number(text(form, "below")) * 100),
        rateAboveBp: Math.round(
          Number(text(form, "above") || text(form, "below")) * 100,
        ),
        effectiveFrom: text(form, "from"),
      })
      if (result.ok) {
        setErrors({})
        toast.success("Tax rule added")
      } else {
        setErrors(result.fieldErrors ?? {})
        toast.error(result.message)
      }
    })
  }
  return (
    <details className="mt-4 rounded-sm border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Add a rule
      </summary>
      <form onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-5">
        <Field label="HSN prefix" error={errors.hsnPrefix}>
          <input
            name="hsn"
            required
            pattern="[0-9]{2,8}"
            className={`${field} font-mono`}
          />
        </Field>
        <Field label="Up to (₹, optional)" error={errors.priceThresholdPaise}>
          <input
            name="threshold"
            type="number"
            min={1}
            step="1"
            className={field}
          />
        </Field>
        <Field label="Rate %" error={errors.rateBelowBp}>
          <input
            name="below"
            type="number"
            min={0}
            max={100}
            step="0.01"
            required
            className={field}
          />
        </Field>
        <Field label="Above %" error={errors.rateAboveBp}>
          <input
            name="above"
            type="number"
            min={0}
            max={100}
            step="0.01"
            className={field}
          />
        </Field>
        <Field label="From" error={errors.effectiveFrom}>
          <input name="from" type="date" required className={field} />
        </Field>
        <Button
          type="submit"
          size="sm"
          disabled={pending}
          className="rounded-sm sm:col-span-5 sm:justify-self-start"
        >
          {pending ? "Adding…" : "Add rule"}
        </Button>
      </form>
    </details>
  )
}

const MODE_TONE = {
  live: "good",
  test: "info",
  demo: "warn",
  problem: "bad",
} as const

export function IntegrationsPanel({
  health,
  canTest,
}: {
  health: IntegrationStatus[]
  canTest: boolean
}) {
  const [pending, startTransition] = useTransition()
  const test = (target: "payments" | "shipping" | "email" | "storage") =>
    startTransition(async () => {
      const result = await testIntegrationAction(target)
      if (result.ok) toast.success(result.message)
      else toast.error(result.message)
    })
  return (
    <section
      id="integrations"
      aria-labelledby="integrations-title"
      className="scroll-mt-20 rounded-sm border bg-card p-4"
    >
      <h2 id="integrations-title" className="font-semibold">
        Integrations
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Providers and keys are set in the server environment, never here.
      </p>
      <ul className="mt-3 divide-y text-sm">
        {health.map((item) => (
          <li
            key={item.key}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2 font-medium">
                {item.label}
                <StatusBadge tone={MODE_TONE[item.mode]}>
                  {item.mode}
                </StatusBadge>
                <span className="font-normal text-muted-foreground">
                  {item.provider}
                </span>
              </span>
              <span className="block text-muted-foreground">{item.detail}</span>
            </span>
            {canTest && item.testable && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                className="rounded-sm"
                onClick={() =>
                  test(
                    item.key as "payments" | "shipping" | "email" | "storage",
                  )
                }
              >
                Test
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
