import "server-only"
import { headers } from "next/headers"

import type { Actor } from "./actor"
import { getAuth } from "./auth"
import { parseRoles } from "./roles"

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/

/** The actor behind a request, from its session cookie. */
export async function actorFromHeaders(
  requestHeaders: Headers,
): Promise<Actor> {
  const incoming = requestHeaders.get("x-request-id")
  const requestId =
    incoming && REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID()
  const ip = requestHeaders.get("x-real-ip")

  const session = await getAuth().api.getSession({ headers: requestHeaders })
  if (!session) return { kind: "anonymous", requestId, ip }

  return {
    kind: "user",
    userId: session.user.id,
    roles: parseRoles(session.user.role),
    twoFactorEnabled: Boolean(session.user.twoFactorEnabled),
    requestId,
    ip,
  }
}

/** For Server Components, Server Actions and route handlers. */
export async function getActor(): Promise<Actor> {
  return actorFromHeaders(await headers())
}
