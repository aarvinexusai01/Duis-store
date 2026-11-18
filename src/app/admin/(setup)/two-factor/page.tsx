import type { Metadata, Route } from "next"
import { notFound, redirect } from "next/navigation"
import { Suspense } from "react"

import { Wordmark } from "@/components/brand/wordmark"
import { isStaff } from "@/server/auth/roles"
import { getActor } from "@/server/auth/session"

import { TwoFactorSetup } from "./two-factor-setup"

export const metadata: Metadata = { title: "Set up two-factor authentication" }

export default function TwoFactorPage() {
  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12"
    >
      <Wordmark className="text-4xl" />
      <h1 className="display-heading text-4xl">Secure your staff account</h1>
      <Suspense fallback={null}>
        <Setup />
      </Suspense>
    </main>
  )
}

async function Setup() {
  const actor = await getActor()
  if (actor.kind !== "user") redirect("/login?next=/admin/two-factor" as Route)
  if (!isStaff(actor.roles)) notFound()
  if (actor.twoFactorEnabled) redirect("/admin" as Route)
  return <TwoFactorSetup />
}
