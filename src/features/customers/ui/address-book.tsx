"use client"

import { PlusIcon } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { COUNTRY_CODES, countryName } from "@/lib/countries"
import { INDIAN_STATES, suggestStateForPincode } from "@/lib/india"

import { deleteAddressAction, saveAddressAction } from "../actions"
import type { Address } from "../service"

const countries = COUNTRY_CODES.map((code) => ({
  code,
  name: countryName(code),
})).sort((a, b) =>
  a.code === "IN" ? -1 : b.code === "IN" ? 1 : a.name.localeCompare(b.name),
)

export function AddressBook({ addresses }: { addresses: Address[] }) {
  const [editing, setEditing] = useState<Address | "new" | null>(
    addresses.length === 0 ? "new" : null,
  )
  const [pending, startTransition] = useTransition()

  const remove = (id: string) =>
    startTransition(async () => {
      const result = await deleteAddressAction(id)
      if (result.ok) toast.success("Address removed")
      else toast.error(result.message)
    })
  const makeDefault = (address: Address) =>
    startTransition(async () => {
      const result = await saveAddressAction({
        ...toInput(address),
        isDefault: true,
      })
      if (!result.ok) toast.error(result.message)
    })

  if (editing) {
    return (
      <AddressForm
        address={editing === "new" ? null : editing}
        onDone={() => setEditing(null)}
        canCancel={addresses.length > 0}
      />
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <ul className="grid gap-4 sm:grid-cols-2">
        {addresses.map((address) => (
          <li
            key={address.id}
            className="flex flex-col gap-2 border bg-card p-4 text-sm"
          >
            <p className="flex items-center gap-2 font-semibold">
              {address.fullName}
              <span className="border px-1.5 text-[0.6875rem] uppercase">
                {address.type}
              </span>
              {address.isDefault && (
                <span className="bg-ink px-1.5 text-[0.6875rem] text-paper uppercase">
                  Default
                </span>
              )}
            </p>
            <p className="text-muted-foreground">
              {[address.line1, address.line2, address.landmark]
                .filter(Boolean)
                .join(", ")}
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
            </p>
            <div className="mt-auto flex gap-3 pt-2">
              <button
                type="button"
                className="underline"
                onClick={() => setEditing(address)}
              >
                Edit
              </button>
              {!address.isDefault && (
                <button
                  type="button"
                  className="underline"
                  disabled={pending}
                  onClick={() => makeDefault(address)}
                >
                  Make default
                </button>
              )}
              <button
                type="button"
                className="text-destructive underline"
                disabled={pending}
                onClick={() => remove(address.id)}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      <Button
        variant="outline"
        className="h-11 w-fit rounded-none"
        onClick={() => setEditing("new")}
      >
        <PlusIcon /> Add address
      </Button>
    </div>
  )
}

function toInput(address: Address) {
  return {
    id: address.id,
    fullName: address.fullName,
    phone: address.phone,
    line1: address.line1,
    line2: address.line2 ?? undefined,
    landmark: address.landmark ?? undefined,
    city: address.city,
    region: address.region ?? undefined,
    stateCode: address.stateCode ?? undefined,
    postalCode: address.postalCode,
    countryCode: address.countryCode,
    type: address.type as "home" | "work" | "other",
    isDefault: address.isDefault,
  }
}

export function AddressForm({
  address,
  onDone,
  canCancel,
}: {
  address: Address | null
  /** Called with the saved address id, or without one on cancel. */
  onDone: (savedId?: string) => void
  canCancel: boolean
}) {
  const [country, setCountry] = useState(address?.countryCode ?? "IN")
  const [stateCode, setStateCode] = useState(address?.stateCode ?? "")
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({})
  const [message, setMessage] = useState("")
  const [pending, startTransition] = useTransition()
  const india = country === "IN"

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = (name: string) => String(form.get(name) ?? "")
    startTransition(async () => {
      const result = await saveAddressAction({
        id: address?.id,
        fullName: text("fullName"),
        phone: text("phone"),
        line1: text("line1"),
        line2: text("line2"),
        landmark: text("landmark"),
        city: text("city"),
        region: text("region"),
        stateCode,
        postalCode: text("postalCode"),
        countryCode: country,
        type: text("type") as "home" | "work" | "other",
        isDefault: form.get("isDefault") === "on",
      })
      if (result.ok) {
        toast.success("Address saved")
        onDone(result.id)
      } else {
        setErrors(result.fieldErrors ?? {})
        setMessage(result.message)
      }
    })
  }

  const field = (
    name: string,
    label: string,
    props: React.ComponentProps<"input"> = {},
  ) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`address-${name}`} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={`address-${name}`}
        name={name}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={errors[name] ? `address-${name}-error` : undefined}
        className="h-11 border border-input bg-card px-3 text-base sm:text-sm"
        {...props}
      />
      {errors[name] && (
        <p id={`address-${name}-error`} className="text-xs text-destructive">
          {errors[name]![0]}
        </p>
      )}
    </div>
  )

  return (
    <form
      onSubmit={submit}
      className="grid max-w-2xl gap-4 sm:grid-cols-2"
      noValidate
    >
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <label htmlFor="address-country" className="text-sm font-medium">
          Country
        </label>
        <select
          id="address-country"
          value={country}
          onChange={(event) => setCountry(event.target.value)}
          className="h-11 border border-input bg-card px-2 text-sm"
        >
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {field("fullName", "Full name", {
        defaultValue: address?.fullName,
        autoComplete: "name",
        required: true,
      })}
      {field(
        "phone",
        india ? "Mobile number (10 digits)" : "Phone (with country code)",
        {
          defaultValue: address?.phone,
          autoComplete: "tel",
          inputMode: "tel",
          required: true,
        },
      )}
      <div className="sm:col-span-2">
        {field("line1", "Address", {
          defaultValue: address?.line1,
          autoComplete: "address-line1",
          required: true,
        })}
      </div>
      {field("line2", "Apartment, floor (optional)", {
        defaultValue: address?.line2 ?? "",
        autoComplete: "address-line2",
      })}
      {field("landmark", "Landmark (optional)", {
        defaultValue: address?.landmark ?? "",
      })}
      {field("postalCode", india ? "PIN code" : "Postal code", {
        defaultValue: address?.postalCode,
        autoComplete: "postal-code",
        inputMode: india ? "numeric" : "text",
        maxLength: india ? 6 : 12,
        required: true,
        onBlur: (event) => {
          if (!india || stateCode) return
          const suggestion = suggestStateForPincode(
            event.currentTarget.value.trim(),
          )
          if (suggestion) setStateCode(suggestion)
        },
      })}
      {field("city", "City", {
        defaultValue: address?.city,
        autoComplete: "address-level2",
        required: true,
      })}
      {india ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="address-state" className="text-sm font-medium">
            State
          </label>
          <select
            id="address-state"
            value={stateCode}
            onChange={(event) => setStateCode(event.target.value)}
            aria-invalid={errors.stateCode ? true : undefined}
            className="h-11 border border-input bg-card px-2 text-sm"
          >
            <option value="">Choose…</option>
            {INDIAN_STATES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
          {errors.stateCode && (
            <p className="text-xs text-destructive">{errors.stateCode[0]}</p>
          )}
        </div>
      ) : (
        field("region", "State / region (optional)", {
          defaultValue: address?.region ?? "",
          autoComplete: "address-level1",
        })
      )}
      <fieldset className="flex items-center gap-4 text-sm sm:col-span-2">
        <legend className="sr-only">Address type</legend>
        {(["home", "work", "other"] as const).map((type) => (
          <label key={type} className="flex items-center gap-1.5 capitalize">
            <input
              type="radio"
              name="type"
              value={type}
              defaultChecked={(address?.type ?? "home") === type}
            />
            {type}
          </label>
        ))}
        <label className="ml-auto flex items-center gap-1.5">
          <input
            type="checkbox"
            name="isDefault"
            defaultChecked={address?.isDefault}
          />
          Default address
        </label>
      </fieldset>
      {message && (
        <p
          role="alert"
          className="text-sm font-medium text-destructive sm:col-span-2"
        >
          {message}
        </p>
      )}
      <div className="flex gap-3 sm:col-span-2">
        <Button
          type="submit"
          disabled={pending}
          className="h-11 rounded-none px-6 font-semibold uppercase"
        >
          {pending ? "Saving…" : "Save address"}
        </Button>
        {canCancel && (
          <Button
            type="button"
            variant="ghost"
            className="h-11 rounded-none"
            onClick={() => onDone()}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}
