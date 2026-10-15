import "server-only"
import type { Route } from "next"
import { redirect } from "next/navigation"

import type { UserActor } from "@/server/auth/actor"
import { getActor } from "@/server/auth/session"

/** The signed-in customer, or a redirect to /login that comes back here. */
export async function requireUser(returnTo: string): Promise<UserActor> {
  const actor = await getActor()
  if (actor.kind !== "user") {
    redirect(`/login?next=${encodeURIComponent(returnTo)}` as Route)
  }
  return actor
}

/** Signed-in visitors skip the sign-in pages. */
export async function redirectIfSignedIn(next: string): Promise<void> {
  const actor = await getActor()
  if (actor.kind === "user") redirect(next as Route)
}
