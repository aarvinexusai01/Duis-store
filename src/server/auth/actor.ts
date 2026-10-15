import { isStaff, type RoleName } from "./roles"

/**
 * Who is performing an operation. Every service entry point receives one and
 * authorizes against it (doc/02 §2, rule 3).
 */
export type Actor =
  | { kind: "anonymous"; requestId: string; ip: string | null }
  | {
      kind: "user"
      userId: string
      roles: RoleName[]
      twoFactorEnabled: boolean
      requestId: string
      ip: string | null
    }
  | { kind: "system"; name: string; requestId: string }

export type UserActor = Extract<Actor, { kind: "user" }>

export function systemActor(name: string): Actor {
  return {
    kind: "system",
    name,
    requestId: `system:${name}:${crypto.randomUUID()}`,
  }
}

export function isStaffActor(actor: Actor): actor is UserActor {
  return actor.kind === "user" && isStaff(actor.roles)
}

/** Fields recorded with audit entries and logs. */
export function describeActor(actor: Actor) {
  switch (actor.kind) {
    case "user":
      return {
        actorType: "user",
        actorUserId: actor.userId,
        actorRoles: actor.roles,
        ip: actor.ip,
      }
    case "system":
      return {
        actorType: "system",
        actorUserId: null,
        actorRoles: [],
        ip: null,
      }
    default:
      return {
        actorType: "anonymous",
        actorUserId: null,
        actorRoles: [],
        ip: actor.ip,
      }
  }
}

/** For public reads where who is asking does not matter (e.g. stock levels). */
export function anonymousActor(): Actor {
  return { kind: "anonymous", requestId: crypto.randomUUID(), ip: null }
}
