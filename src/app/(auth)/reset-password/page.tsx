import type { Metadata } from "next"
import { Suspense } from "react"

import { ResetPasswordForm } from "@/features/auth/ui/account-forms"

export const metadata: Metadata = { title: "Choose a new password" }

export default function ResetPasswordPage({
  searchParams,
}: PageProps<"/reset-password">) {
  return (
    <>
      <h1 className="mb-8 display-heading text-5xl">New password</h1>
      <Suspense fallback={null}>
        <Form searchParams={searchParams} />
      </Suspense>
    </>
  )
}

async function Form({
  searchParams,
}: Pick<PageProps<"/reset-password">, "searchParams">) {
  const { token } = await searchParams
  return <ResetPasswordForm token={typeof token === "string" ? token : ""} />
}
