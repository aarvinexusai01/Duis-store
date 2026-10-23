import type { Metadata } from "next"
import Link from "next/link"
import { Suspense } from "react"

import { Wordmark } from "@/components/brand/wordmark"
import { getInvitation } from "@/features/staff"
import { getActor } from "@/server/auth/session"

import { JoinForm } from "./join-form"

export const metadata: Metadata = { title: "Join the Duis team" }

export default function JoinPage({ searchParams }: PageProps<"/admin/join">) {
  return (
    <main
      id="main"
      className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-12"
    >
      <Wordmark className="text-4xl" large />
      <h1 className="display-heading text-4xl">Join the Duis team</h1>
      <Suspense fallback={null}>
        <Join searchParams={searchParams} />
      </Suspense>
    </main>
  )
}

async function Join({
  searchParams,
}: Pick<PageProps<"/admin/join">, "searchParams">) {
  const raw = await searchParams
  const token = typeof raw.token === "string" ? raw.token : ""
  const actor = await getActor()
  const invitation = await getInvitation(actor, { token })
  if (invitation.status !== "valid") {
    return (
      <p role="alert" className="text-sm">
        {invitation.status === "used"
          ? "This invitation was already used. "
          : invitation.status === "expired"
            ? "This invitation has expired. "
            : "This invitation link isn't valid. "}
        Ask a Super Admin for a new one, or{" "}
        <Link
          href="/login?next=/admin"
          className="underline underline-offset-4"
        >
          sign in
        </Link>{" "}
        if you already joined.
      </p>
    )
  }
  return (
    <JoinForm
      token={token}
      email={invitation.email}
      roles={invitation.roles}
      hasAccount={invitation.hasAccount}
      signedIn={actor.kind === "user"}
    />
  )
}
