"use client"

import Link from "next/link"
import { useActionState, useId } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import {
  subscribeToNewsletter,
  type NewsletterState,
} from "@/features/marketing/actions"

/** Email sign-up; works without JavaScript (progressive enhancement). */
export function NewsletterForm({
  source = "footer",
  tone = "dark",
  className,
}: {
  source?: "footer" | "home"
  tone?: "dark" | "light"
  className?: string
}) {
  const id = useId()
  const [state, action, pending] = useActionState<NewsletterState, FormData>(
    subscribeToNewsletter,
    { status: "idle" },
  )

  return (
    <form action={action} className={cn("w-full max-w-md", className)}>
      <input type="hidden" name="source" value={source} />
      <label htmlFor={`${id}-email`} className="sr-only">
        Email address
      </label>
      <div className="flex">
        <input
          id={`${id}-email`}
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          aria-describedby={`${id}-status`}
          aria-invalid={state.status === "error" || undefined}
          className={cn(
            "h-11 min-w-0 flex-1 border px-3 text-sm",
            tone === "dark"
              ? "border-white/30 bg-transparent text-paper placeholder:text-chrome-muted"
              : "border-input bg-card text-foreground placeholder:text-muted-foreground",
          )}
        />
        <Button
          type="submit"
          disabled={pending}
          className="h-11 rounded-none bg-rust px-5 font-semibold tracking-wide text-rust-foreground uppercase hover:bg-rust/90"
        >
          {pending ? "Sending…" : "Subscribe"}
        </Button>
      </div>
      <p
        id={`${id}-status`}
        role="status"
        className={cn(
          "mt-2 min-h-5 text-sm",
          state.status === "error" && "font-medium text-[#ff9a7a]",
          state.status === "error" && tone === "light" && "text-destructive",
        )}
      >
        {state.status === "idle" ? null : state.message}
      </p>
      <p
        className={cn(
          "text-xs",
          tone === "dark" ? "text-chrome-muted" : "text-muted-foreground",
        )}
      >
        Drops, restocks and offers. Unsubscribe any time. See our{" "}
        <Link
          href="/policies/privacy-policy"
          className="underline underline-offset-2"
        >
          privacy policy
        </Link>
        .
      </p>
    </form>
  )
}
