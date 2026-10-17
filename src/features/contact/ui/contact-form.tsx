"use client"

import { useActionState, useEffect, useId } from "react"

import { useTurnstile } from "@/components/turnstile"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { sendContactMessageAction, type ContactFormState } from "../actions"
import { CONTACT_TOPICS } from "../schemas"

const inputClass =
  "h-11 w-full border border-input bg-card px-3 text-base sm:text-sm aria-invalid:border-destructive"

/** The contact form below the CMS content on /contact. Works without JS. */
export function ContactForm({
  turnstileSiteKey,
}: {
  turnstileSiteKey: string | null
}) {
  const id = useId()
  const turnstile = useTurnstile(turnstileSiteKey)
  const [state, action, pending] = useActionState<ContactFormState, FormData>(
    sendContactMessageAction,
    { status: "idle" },
  )
  const { reset } = turnstile
  useEffect(() => {
    if (state.status !== "idle") reset()
  }, [state, reset])

  if (state.status === "sent") {
    return (
      <div role="status" className="border bg-card p-6">
        <h2 className="text-xl font-semibold">Thanks, we&apos;ve got it</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          We reply by email, usually within one working day.
        </p>
      </div>
    )
  }

  const fields = state.status === "error" ? (state.fields ?? {}) : {}
  const field = (
    name: string,
    label: string,
    input: (props: {
      id: string
      name: string
      "aria-invalid"?: true
      "aria-describedby"?: string
    }) => React.ReactNode,
    hint?: string,
  ) => {
    const error = fields[name]
    const fieldId = `${id}-${name}`
    return (
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fieldId} className="text-sm font-medium">
          {label}
        </label>
        {input({
          id: fieldId,
          name,
          ...(error ? { "aria-invalid": true as const } : {}),
          ...(error || hint ? { "aria-describedby": `${fieldId}-help` } : {}),
        })}
        {(error || hint) && (
          <p
            id={`${fieldId}-help`}
            className={cn(
              "text-xs",
              error ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {error ?? hint}
          </p>
        )}
      </div>
    )
  }

  return (
    <form
      action={action}
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-4"
    >
      <h2 id={`${id}-title`} className="text-2xl font-semibold">
        Send us a message
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {field("name", "Name", (p) => (
          <input
            {...p}
            required
            maxLength={100}
            autoComplete="name"
            className={inputClass}
          />
        ))}
        {field("email", "Email", (p) => (
          <input
            {...p}
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            className={inputClass}
          />
        ))}
        {field("phone", "Phone (optional)", (p) => (
          <input
            {...p}
            type="tel"
            maxLength={20}
            autoComplete="tel"
            className={inputClass}
          />
        ))}
        {field("orderNumber", "Order number (optional)", (p) => (
          <input
            {...p}
            maxLength={30}
            placeholder="DUIS-100001"
            className={cn(inputClass, "uppercase placeholder:normal-case")}
          />
        ))}
      </div>
      {field("topic", "What's it about?", (p) => (
        <select {...p} required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Choose a topic
          </option>
          {Object.entries(CONTACT_TOPICS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      ))}
      {field("message", "Message", (p) => (
        <textarea
          {...p}
          required
          minLength={10}
          maxLength={5000}
          rows={6}
          className="w-full border border-input bg-card p-3 text-base aria-invalid:border-destructive sm:text-sm"
        />
      ))}
      {/* Hidden from people; bots that fill it are ignored. */}
      <div
        aria-hidden
        className="absolute -left-[9999px] h-px w-px overflow-hidden"
      >
        <label htmlFor={`${id}-website`}>Website</label>
        <input
          id={`${id}-website`}
          name="website"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>
      <input type="hidden" name="turnstile" value={turnstile.token ?? ""} />
      {turnstile.element}
      {state.status === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        We use these details only to reply to you.
      </p>
      <Button
        type="submit"
        disabled={pending || !turnstile.ready}
        className="h-11 self-start rounded-none px-6"
      >
        {pending ? "Sending…" : "Send message"}
      </Button>
    </form>
  )
}
