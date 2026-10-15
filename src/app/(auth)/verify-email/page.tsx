import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"

export const metadata: Metadata = { title: "Verify your email" }

export default function VerifyEmailPage({
  searchParams,
}: PageProps<"/verify-email">) {
  return (
    <>
      <h1 className="mb-6 display-heading text-5xl">Verify email</h1>
      <Suspense fallback={null}>
        <Status searchParams={searchParams} />
      </Suspense>
    </>
  )
}

async function Status({
  searchParams,
}: Pick<PageProps<"/verify-email">, "searchParams">) {
  const { error } = await searchParams
  if (error) {
    return (
      <p role="alert" className="text-sm">
        This verification link has expired or was already used. Sign in with
        your email and password and we&apos;ll send you a fresh one.{" "}
        <Link href="/login" className="font-semibold underline">
          Sign in
        </Link>
      </p>
    )
  }
  return (
    <p className="text-sm">
      Check your inbox for a link from us. It expires in 24 hours.
    </p>
  )
}
