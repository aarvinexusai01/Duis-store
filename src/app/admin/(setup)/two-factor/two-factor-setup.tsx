"use client"

import { useRouter } from "next/navigation"
import QRCode from "qrcode"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth-client"
import { authErrorMessage } from "@/lib/auth-errors"

type Step =
  | { kind: "password" }
  | { kind: "scan"; uri: string; qr: string; backupCodes: string[] }
  | { kind: "done"; backupCodes: string[] }

/**
 * Staff permissions need TOTP two-factor (doc/08). Better Auth issues the
 * secret after the password is confirmed and enables it once a code from
 * the authenticator app verifies.
 */
export function TwoFactorSetup() {
  const router = useRouter()
  const [step, setStep] = useState<Step>({ kind: "password" })
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  const start = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setPending(true)
    setError("")
    const password = String(new FormData(event.currentTarget).get("password"))
    const { data, error } = await authClient.twoFactor.enable({ password })
    setPending(false)
    if (error || !data || !("totpURI" in data)) {
      setError(authErrorMessage(error))
      return
    }
    const qr = await QRCode.toDataURL(data.totpURI, { margin: 1, width: 220 })
    setStep({
      kind: "scan",
      uri: data.totpURI,
      qr,
      backupCodes: data.backupCodes,
    })
  }

  const verify = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (step.kind !== "scan") return
    setPending(true)
    setError("")
    const code = String(new FormData(event.currentTarget).get("code")).replace(
      /\s/g,
      "",
    )
    const { error } = await authClient.twoFactor.verifyTotp({ code })
    setPending(false)
    if (error) {
      setError(authErrorMessage(error))
      return
    }
    setStep({ kind: "done", backupCodes: step.backupCodes })
  }

  if (step.kind === "password") {
    return (
      <form onSubmit={start} className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Staff tools need a second step at sign-in: a 6-digit code from an
          authenticator app (Google Authenticator, 1Password, Authy…). Confirm
          your password to begin.
        </p>
        <label htmlFor="tf-password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="tf-password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="h-11 border border-input bg-card px-3"
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending} className="h-11 rounded-none">
          Continue
        </Button>
      </form>
    )
  }

  if (step.kind === "scan") {
    const secret = new URL(step.uri).searchParams.get("secret") ?? ""
    return (
      <form onSubmit={verify} className="flex flex-col gap-4">
        <p className="text-sm">
          Scan this code with your authenticator app, then enter the 6-digit
          code it shows.
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
        <img
          src={step.qr}
          alt="QR code for your authenticator app"
          width={220}
          height={220}
          className="border bg-white p-2"
        />
        <p className="text-xs text-muted-foreground">
          Can&apos;t scan? Enter this key manually:{" "}
          <code className="bg-muted px-1 break-all">{secret}</code>
        </p>
        <label htmlFor="tf-code" className="text-sm font-medium">
          6-digit code
        </label>
        <input
          id="tf-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          required
          className="h-11 border border-input bg-card px-3 tracking-widest"
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending} className="h-11 rounded-none">
          Verify and turn on
        </Button>
      </form>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="font-semibold">
        Two-factor authentication is on.
      </p>
      <p className="text-sm">
        Save these backup codes somewhere safe (a password manager). Each one
        works once if you lose your phone. They won&apos;t be shown again.
      </p>
      <ul className="grid grid-cols-2 gap-2 border bg-card p-4 font-mono text-sm">
        {step.backupCodes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <Button
        className="h-11 rounded-none"
        onClick={() => {
          router.replace("/admin")
          router.refresh()
        }}
      >
        Continue to admin
      </Button>
    </div>
  )
}
