import type { Metadata } from "next"
import { Suspense } from "react"

import { UnsubscribeForm } from "./unsubscribe-form"

export const metadata: Metadata = {
  title: "Unsubscribe",
  robots: { index: false, follow: false },
}

export default function UnsubscribePage({
  searchParams,
}: PageProps<"/unsubscribe">) {
  return (
    <div className="page-container max-w-lg py-16">
      <h1 className="display-heading text-4xl">Unsubscribe</h1>
      <Suspense fallback={null}>
        <Form searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function Form({
  searchParams,
}: Pick<PageProps<"/unsubscribe">, "searchParams">) {
  const raw = await searchParams
  const u = typeof raw.u === "string" ? raw.u : ""
  const t = typeof raw.t === "string" ? raw.t : ""
  return <UnsubscribeForm u={u} t={t} />
}
