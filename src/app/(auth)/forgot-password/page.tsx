import type { Metadata } from "next"
import { connection } from "next/server"
import { Suspense } from "react"

import { getServerEnv } from "@/config/env"
import { ForgotPasswordForm } from "@/features/auth/ui/account-forms"

export const metadata: Metadata = { title: "Forgot password" }

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-2 display-heading text-5xl">Forgot password</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        We&apos;ll email you a link to choose a new one.
      </p>
      <Suspense fallback={null}>
        <Form />
      </Suspense>
    </>
  )
}

/** Request time: the Turnstile key is runtime configuration. */
async function Form() {
  await connection()
  return (
    <ForgotPasswordForm
      turnstileSiteKey={getServerEnv().TURNSTILE_SITE_KEY ?? null}
    />
  )
}
