"use client"

import Link from "next/link"
import { useState } from "react"

import { authClient } from "@/lib/auth-client"
import { completeSignInUrl } from "@/lib/safe-redirect"

import {
  authErrorMessage,
  FormMessage,
  SubmitButton,
  TextField,
} from "./form-bits"
import { useTurnstile } from "./turnstile"

export function RegisterForm({
  next,
  turnstileSiteKey = null,
}: {
  next: string
  turnstileSiteKey?: string | null
}) {
  const captcha = useTurnstile(turnstileSiteKey)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get("email"))
    setError("")
    setPending(true)
    const { error } = await authClient.signUp.email(
      {
        name: String(form.get("name")).trim(),
        email,
        password: String(form.get("password")),
        // The verification link signs the customer in and lands here.
        callbackURL: completeSignInUrl(next),
      },
      captcha.fetchOptions ? { ...captcha.fetchOptions } : undefined,
    )
    captcha.reset()
    setPending(false)
    if (error) setError(authErrorMessage(error))
    else setSentTo(email)
  }

  if (sentTo) {
    return (
      <FormMessage tone="info">
        Almost done — we&apos;ve sent a link to <strong>{sentTo}</strong>. Open
        it to confirm your email and sign in.
      </FormMessage>
    )
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <TextField
        id="register-name"
        name="name"
        label="Full name"
        autoComplete="name"
        required
        maxLength={100}
      />
      <TextField
        id="register-email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        required
      />
      <TextField
        id="register-password"
        name="password"
        type="password"
        label="Password"
        autoComplete="new-password"
        minLength={10}
        maxLength={128}
        required
        hint="At least 10 characters."
      />
      <FormMessage tone="error">{error}</FormMessage>
      {captcha.element}
      <SubmitButton pending={pending}>Create account</SubmitButton>
      <p className="text-xs text-muted-foreground">
        By creating an account you agree to our{" "}
        <Link href="/policies/terms-of-service" className="underline">
          terms
        </Link>{" "}
        and{" "}
        <Link href="/policies/privacy-policy" className="underline">
          privacy policy
        </Link>
        .
      </p>
    </form>
  )
}

export function ForgotPasswordForm({
  turnstileSiteKey = null,
}: {
  turnstileSiteKey?: string | null
}) {
  const captcha = useTurnstile(turnstileSiteKey)
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState("")

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    setError("")
    const { error } = await authClient.requestPasswordReset(
      {
        email: String(form.get("email")),
        redirectTo: "/reset-password",
      },
      captcha.fetchOptions ? { ...captcha.fetchOptions } : undefined,
    )
    captcha.reset()
    setPending(false)
    // The same message whether or not the address has an account.
    if (error?.status === 429) setError(authErrorMessage(error))
    else setDone(true)
  }

  if (done) {
    return (
      <FormMessage tone="info">
        If that email has an account, a reset link is on its way. It expires in
        1 hour.
      </FormMessage>
    )
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <TextField
        id="forgot-email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        required
      />
      <FormMessage tone="error">{error}</FormMessage>
      {captcha.element}
      <SubmitButton pending={pending}>Send reset link</SubmitButton>
    </form>
  )
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState("")

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const password = String(form.get("password"))
    if (password !== String(form.get("confirm"))) {
      setError("The passwords don't match.")
      return
    }
    setPending(true)
    setError("")
    const { error } = await authClient.resetPassword({
      newPassword: password,
      token,
    })
    setPending(false)
    if (error) setError(authErrorMessage(error))
    else setDone(true)
  }

  if (!token) {
    return (
      <FormMessage tone="error">
        This reset link is incomplete.{" "}
        <Link href="/forgot-password" className="underline">
          Request a new one
        </Link>
        .
      </FormMessage>
    )
  }
  if (done) {
    return (
      <FormMessage tone="info">
        Password changed, and you&apos;ve been signed out everywhere.{" "}
        <Link href="/login" className="font-semibold underline">
          Sign in
        </Link>
      </FormMessage>
    )
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <TextField
        id="reset-password"
        name="password"
        type="password"
        label="New password"
        autoComplete="new-password"
        minLength={10}
        maxLength={128}
        required
        hint="At least 10 characters."
      />
      <TextField
        id="reset-confirm"
        name="confirm"
        type="password"
        label="Repeat new password"
        autoComplete="new-password"
        required
      />
      <FormMessage tone="error">{error}</FormMessage>
      <SubmitButton pending={pending}>Change password</SubmitButton>
    </form>
  )
}
