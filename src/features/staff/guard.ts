import "server-only"
import type { Route } from "next"
import { notFound, redirect } from "next/navigation"

import type { UserActor } from "@/server/auth/actor"
import { rolesAllow, type PermissionRequest } from "@/server/auth/permissions"
import { isStaff } from "@/server/auth/roles"
import { getActor } from "@/server/auth/session"

/**
 * Admin pages (doc/04 §3): signed in, a staff role, and two-factor set up.
 * Non-staff get a 404 so the portal's pages are not advertised. This is a
 * convenience for pages; every operation authorizes again (doc/08).
 */
export async function requireStaff(returnTo: string): Promise<UserActor> {
  const actor = await getActor()
  if (actor.kind !== "user") {
    redirect(`/login?next=${encodeURIComponent(returnTo)}` as Route)
  }
  if (!isStaff(actor.roles)) notFound()
  if (!actor.twoFactorEnabled) redirect("/admin/two-factor" as Route)
  return actor
}

export function can(actor: UserActor, request: PermissionRequest): boolean {
  return rolesAllow(actor.roles, request)
}
