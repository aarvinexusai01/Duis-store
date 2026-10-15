"use client"

import Link from "next/link"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { authClient } from "@/lib/auth-client"
import { completeSignInUrl } from "@/lib/safe-redirect"

import {
  authErrorMessage,
  FormMessage,
  SubmitButton,
  TextField,
} from "./form-bits"

/** Phone OTP first (doc/01), then email and password, then Google. */
export function LoginForm({
  next,
  googleEnabled,
}: {
  next: string
  googleEnabled: boolean
}) {
  const done = () => window.location.assign(completeSignInUrl(next))
  return (
    <div className="flex flex-col gap-6">
      <Tabs defaultValue="phone">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="phone">Mobile number</TabsTrigger>
          <TabsTrigger value="email">Email</TabsTrigger>
        </TabsList>
        <TabsContent value="phone" className="pt-4">
          <PhoneLogin onDone={done} />
        </TabsContent>
        <TabsContent value="email" className="pt-4">
          <EmailLogin onDone={done} />
        </TabsContent>
      </Tabs>
      {googleEnabled && (
        <>
          <div className="flex items-center gap-3 text-xs text-muted-foreground uppercase">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button
            variant="outline"
            className="h-12 rounded-none border-ink font-semibold"
            onClick={() =>
              authClient.signIn.social({
                provider: "google",
                callbackURL: completeSignInUrl(next),
              })
            }
          >
            Continue with Google
          </Button>
        </>
      )}
    </div>
  )
}

function PhoneLogin({ onDone }: { onDone: () => void }) {
  const [digits, setDigits] = useState("")
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  const send = async (event?: React.FormEvent) => {
    event?.preventDefault()
    setError("")
    if (!/^[6-9]\d{9}$/.test(digits)) {
      setError("Enter a 10-digit Indian mobile number.")
      return
    }
    setPending(true)
    const phoneNumber = `+91${digits}`
    const { error } = await authClient.phoneNumber.sendOtp({ phoneNumber })
    setPending(false)
    if (error) setError(authErrorMessage(error))
    else setSentTo(phoneNumber)
  }

  const verify = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!sentTo || code.length !== 6) return
    setError("")
    setPending(true)
    const { error } = await authClient.phoneNumber.verify({
      phoneNumber: sentTo,
      code,
    })
    if (error) {
      setPending(false)
      setError(authErrorMessage(error))
      return
    }
    onDone()
  }

  if (!sentTo) {
    return (
      <form onSubmit={send} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="login-phone" className="text-sm font-medium">
            Mobile number
          </label>
          <div className="flex">
            <span className="flex h-11 items-center border border-r-0 border-input bg-secondary px-3 text-sm">
              +91
            </span>
            <input
              id="login-phone"
              name="phone"
              inputMode="numeric"
              autoComplete="tel-national"
              maxLength={10}
              value={digits}
              onChange={(event) =>
                setDigits(event.target.value.replace(/\D/g, ""))
              }
              className="h-11 min-w-0 flex-1 border border-input bg-card px-3 text-base sm:text-sm"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            We&apos;ll text you a 6-digit code. Outside India? Use email.
          </p>
        </div>
        <FormMessage tone="error">{error}</FormMessage>
        <SubmitButton pending={pending} pendingLabel="Sending…">
          Send code
        </SubmitButton>
      </form>
    )
  }

  return (
    <form onSubmit={verify} className="flex flex-col gap-4">
      <p className="text-sm">
        Enter the code sent to <strong>{sentTo}</strong>.{" "}
        <button
          type="button"
          className="underline underline-offset-2"
          onClick={() => {
            setSentTo(null)
            setCode("")
          }}
        >
          Change
        </button>
      </p>
      <label htmlFor="login-otp" className="sr-only">
        One-time code
      </label>
      <InputOTP
        id="login-otp"
        maxLength={6}
        value={code}
        onChange={setCode}
        autoFocus
        inputMode="numeric"
        autoComplete="one-time-code"
      >
        <InputOTPGroup>
          {Array.from({ length: 6 }, (_, index) => (
            <InputOTPSlot
              key={index}
              index={index}
              className="size-11 text-lg"
            />
          ))}
        </InputOTPGroup>
      </InputOTP>
      <FormMessage tone="error">{error}</FormMessage>
      <SubmitButton pending={pending} pendingLabel="Verifying…">
        Verify and continue
      </SubmitButton>
      <button
        type="button"
        onClick={() => send()}
        disabled={pending}
        className="text-sm underline underline-offset-2"
      >
        Send a new code
      </button>
    </form>
  )
}

function EmailLogin({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const [needsTotp, setNeedsTotp] = useState(false)
  const [totp, setTotp] = useState("")

  const signIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setError("")
    setPending(true)
    const { data, error } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    })
    if (error) {
      setPending(false)
      setError(authErrorMessage(error))
      return
    }
    // Staff accounts with two-factor authentication confirm a TOTP code.
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      setPending(false)
      setNeedsTotp(true)
      return
    }
    onDone()
  }

  const verifyTotp = async (event: React.FormEvent) => {
    event.preventDefault()
    setError("")
    setPending(true)
    const { error } = await authClient.twoFactor.verifyTotp({ code: totp })
    if (error) {
      setPending(false)
      setError(authErrorMessage(error))
      return
    }
    onDone()
  }

  if (needsTotp) {
    return (
      <form onSubmit={verifyTotp} className="flex flex-col gap-4">
        <TextField
          id="login-totp"
          label="Authenticator code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={totp}
          onChange={(event) => setTotp(event.target.value.replace(/\D/g, ""))}
          autoFocus
        />
        <FormMessage tone="error">{error}</FormMessage>
        <SubmitButton pending={pending}>Verify</SubmitButton>
      </form>
    )
  }

  return (
    <form onSubmit={signIn} className="flex flex-col gap-4">
      <TextField
        id="login-email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        required
      />
      <TextField
        id="login-password"
        name="password"
        type="password"
        label="Password"
        autoComplete="current-password"
        required
      />
      <FormMessage tone="error">{error}</FormMessage>
      <SubmitButton pending={pending}>Sign in</SubmitButton>
      <div className="flex justify-between text-sm">
        <Link href="/forgot-password" className="underline underline-offset-2">
          Forgot password?
        </Link>
        <Link href="/register" className="underline underline-offset-2">
          Create an account
        </Link>
      </div>
    </form>
  )
}
