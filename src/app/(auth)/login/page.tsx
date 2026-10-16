import type { Metadata } from "next"
import Link from "next/link"
import { connection } from "next/server"
import { Suspense } from "react"

import { getServerEnv } from "@/config/env"
import { redirectIfSignedIn } from "@/features/auth/session-guard"
import { LoginForm } from "@/features/auth/ui/login-form"
import { safeNextPath } from "@/lib/safe-redirect"

export const metadata: Metadata = { title: "Sign in" }

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <>
      <h1 className="mb-2 display-heading text-5xl">Sign in</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        New here? Signing in with your mobile number creates your account.{" "}
        <Link href="/register" className="underline">
          Or register with email
        </Link>
        .
      </p>
      <Suspense fallback={null}>
        <Form searchParams={searchParams} />
      </Suspense>
    </>
  )
}

async function Form({
  searchParams,
}: Pick<PageProps<"/login">, "searchParams">) {
  await connection()
  const raw = (await searchParams).next
  const next = safeNextPath(typeof raw === "string" ? raw : null)
  await redirectIfSignedIn(next)
  return (
    <LoginForm
      turnstileSiteKey={getServerEnv().TURNSTILE_SITE_KEY ?? null}
      next={next}
      googleEnabled={Boolean(getServerEnv().GOOGLE_CLIENT_ID)}
    />
  )
}
