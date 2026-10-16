"use client"

import type { Route } from "next"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { acceptInvitationAction } from "@/features/staff/admin-actions"
import { authClient } from "@/lib/auth-client"

const field = "h-11 w-full rounded-sm border border-input bg-card px-3 text-sm"

/**
 * New people choose a name and password; the account is created and signed
 * in, then two-factor setup follows. People with an account sign in first.
 */
export function JoinForm({
  token,
  email,
  roles,
  hasAccount,
  signedIn,
}: {
  token: string
  email: string
  roles: string[]
  hasAccount: boolean
  signedIn: boolean
}) {
  const router = useRouter()
  const [error, setError] = useState("")
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({})
  const [pending, startTransition] = useTransition()
  const back = `/admin/join?token=${encodeURIComponent(token)}`

  const accept = (name?: string, password?: string) =>
    startTransition(async () => {
      setError("")
      const result = await acceptInvitationAction({ token, name, password })
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {})
        setError(result.message)
        return
      }
      if (password) {
        const signIn = await authClient.signIn.email({ email, password })
        if (signIn.error) {
          router.push(`/login?next=${encodeURIComponent("/admin")}` as Route)
          return
        }
      }
      router.push("/admin/two-factor" as Route)
      router.refresh()
    })

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p>
        You&apos;re invited as <strong>{roles.join(", ")}</strong> with{" "}
        <strong>{email}</strong>.
      </p>
      {hasAccount ? (
        signedIn ? (
          <Button
            className="h-11 rounded-sm"
            disabled={pending}
            onClick={() => accept()}
          >
            {pending ? "Joining…" : "Accept and continue"}
          </Button>
        ) : (
          <p>
            You already have a Duis account with this email.{" "}
            <Link
              href={`/login?next=${encodeURIComponent(back)}` as Route}
              className="font-medium underline underline-offset-4"
            >
              Sign in
            </Link>{" "}
            with it, and you&apos;ll come back here to accept.
          </p>
        )
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            accept(String(form.get("name")), String(form.get("password")))
          }}
        >
          <label className="flex flex-col gap-1">
            Your name
            <input
              name="name"
              required
              minLength={2}
              maxLength={100}
              autoComplete="name"
              className={field}
            />
            {errors.name && (
              <span className="text-destructive">{errors.name[0]}</span>
            )}
          </label>
          <label className="flex flex-col gap-1">
            Choose a password
            <input
              name="password"
              type="password"
              required
              minLength={10}
              maxLength={128}
              autoComplete="new-password"
              className={field}
            />
            <span className="text-xs text-muted-foreground">
              At least 10 characters.
            </span>
            {errors.password && (
              <span className="text-destructive">{errors.password[0]}</span>
            )}
          </label>
          <Button type="submit" className="h-11 rounded-sm" disabled={pending}>
            {pending ? "Creating your account…" : "Create account"}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
