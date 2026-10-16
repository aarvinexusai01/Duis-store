import type { Metadata } from "next"
import Link from "next/link"
import { connection } from "next/server"
import { Suspense } from "react"

import { redirectIfSignedIn } from "@/features/auth/session-guard"
import { getServerEnv } from "@/config/env"
import { RegisterForm } from "@/features/auth/ui/account-forms"
import { safeNextPath } from "@/lib/safe-redirect"

export const metadata: Metadata = { title: "Create an account" }

export default function RegisterPage({ searchParams }: PageProps<"/register">) {
  return (
    <>
      <h1 className="mb-2 display-heading text-5xl">Create account</h1>
      <p className="mb-8 text-sm text-muted-foreground">
        Already have one?{" "}
        <Link href="/login" className="underline">
          Sign in
        </Link>
      </p>
      <Suspense fallback={null}>
        <Form searchParams={searchParams} />
      </Suspense>
    </>
  )
}

async function Form({
  searchParams,
}: Pick<PageProps<"/register">, "searchParams">) {
  await connection()
  const raw = (await searchParams).next
  const next = safeNextPath(typeof raw === "string" ? raw : null)
  await redirectIfSignedIn(next)
  return (
    <RegisterForm
      next={next}
      turnstileSiteKey={getServerEnv().TURNSTILE_SITE_KEY ?? null}
    />
  )
}
