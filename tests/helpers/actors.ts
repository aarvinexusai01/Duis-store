import { randomUUID } from "node:crypto"

import { users } from "@/db/schema"
import { systemActor, type Actor } from "@/server/auth/actor"
import type { RoleName } from "@/server/auth/roles"
import { getDb } from "@/server/db/client"

export const asSystem = (): Actor => systemActor("test")

/** An actor that never touches the database (authorization-only tests). */
export function actorWithRole(
  role: RoleName,
  { twoFactorEnabled = true }: { twoFactorEnabled?: boolean } = {},
): Actor {
  return {
    kind: "user",
    userId: randomUUID(),
    roles: [role],
    twoFactorEnabled,
    requestId: `test-${role}`,
    ip: null,
  }
}

/** A real user row, for operations that write audit entries. */
export async function createUserActor(role: RoleName): Promise<Actor> {
  const [user] = await getDb()
    .insert(users)
    .values({
      name: `Test ${role}`,
      email: `${role}-${randomUUID()}@duis.test`,
      emailVerified: true,
      role,
      twoFactorEnabled: role !== "customer",
    })
    .returning({ id: users.id })
  return {
    kind: "user",
    userId: user!.id,
    roles: [role],
    twoFactorEnabled: role !== "customer",
    requestId: `test-${role}`,
    ip: null,
  }
}

export const unique = (prefix: string) =>
  `${prefix}-${randomUUID().slice(0, 8)}`
