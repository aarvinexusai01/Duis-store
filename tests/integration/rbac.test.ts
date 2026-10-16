import { describe, expect, it } from "vitest"

// Importing the modules registers their operations.
import "@/features/cart"
import "@/features/catalog"
import "@/features/checkout"
import "@/features/cms"
import "@/features/collections"
import "@/features/customers"
import "@/features/discounts"
import "@/features/inventory"
import "@/features/marketing"
import "@/features/media"
import "@/features/orders"
import "@/features/shipping"
import "@/features/wallet"
import "@/features/wishlist"
import type { Actor } from "@/server/auth/actor"
import { rolesAllow } from "@/server/auth/permissions"
import { ROLES, type RoleName } from "@/server/auth/roles"
import { isDomainError } from "@/server/errors"
import { operationRegistry, type OperationAccess } from "@/server/operation"

import { actorWithRole } from "../helpers/actors"
import { closeConnectionsAfterAll } from "../helpers/cleanup"

closeConnectionsAfterAll()

/**
 * Exit criterion: every protected operation × every role, through the real
 * operation wrapper. Each call passes no input, so an allowed caller stops at
 * input validation (nothing is written) and a disallowed one must be stopped
 * before it.
 */
const operations = [...operationRegistry.entries()].sort(([a], [b]) =>
  a.localeCompare(b),
)

function allowedFor(access: OperationAccess, role: RoleName): boolean {
  return (
    access === "public" ||
    access === "authenticated" ||
    rolesAllow([role], access)
  )
}

async function errorCode(name: string, actor: Actor): Promise<string> {
  try {
    await operationRegistry.get(name)!(actor, undefined as never)
    return "no error"
  } catch (err) {
    return isDomainError(err)
      ? err.code
      : `unexpected: ${(err as Error).message}`
  }
}

describe("role × operation matrix", () => {
  it("covers every service operation", () => {
    expect(operations.length).toBeGreaterThanOrEqual(25)
  })

  for (const [name, operation] of operations) {
    describe(name, () => {
      for (const role of ROLES) {
        const allowed = allowedFor(operation.definition.access, role)
        it(`${role} → ${allowed ? "allowed" : "forbidden"}`, async () => {
          expect(await errorCode(name, actorWithRole(role))).toBe(
            allowed ? "VALIDATION_FAILED" : "FORBIDDEN",
          )
        })
      }
    })
  }

  it("requires a session for everything that is not public", async () => {
    const anonymous: Actor = { kind: "anonymous", requestId: "test", ip: null }
    for (const [name, operation] of operations) {
      if (operation.definition.access === "public") continue
      expect([name, await errorCode(name, anonymous)]).toEqual([
        name,
        "UNAUTHENTICATED",
      ])
    }
  })

  it("requires two-factor authentication before staff permissions apply", async () => {
    const staffWithout2fa = actorWithRole("store_admin", {
      twoFactorEnabled: false,
    })
    expect(await errorCode("catalog.createProduct", staffWithout2fa)).toBe(
      "STAFF_2FA_REQUIRED",
    )
  })
})

describe("business rules for roles", () => {
  const can = (role: RoleName, name: string) =>
    allowedFor(operationRegistry.get(name)!.definition.access, role)

  it("lets only content managers and super admins publish content", () => {
    expect(ROLES.filter((role) => can(role, "cms.publishRevision"))).toEqual([
      "super_admin",
      "content_manager",
    ])
  })

  it("lets content editors draft and upload, but not publish or change the catalogue", () => {
    expect(can("content_editor", "cms.savePageDraft")).toBe(true)
    expect(can("content_editor", "media.uploadImage")).toBe(true)
    expect(can("content_editor", "cms.publishRevision")).toBe(false)
    expect(can("content_editor", "catalog.createProduct")).toBe(false)
  })

  it("keeps fulfilment and support staff away from stock and prices", () => {
    for (const role of ["fulfilment_staff", "support_agent"] as const) {
      expect(can(role, "inventory.adjustStock")).toBe(false)
      expect(can(role, "catalog.updateVariant")).toBe(false)
    }
  })

  it("gives customers no staff operation", () => {
    const staffOperations = operations.filter(
      ([, op]) => typeof op.definition.access === "object",
    )
    expect(staffOperations.filter(([name]) => can("customer", name))).toEqual(
      [],
    )
  })

  it("records the full matrix for review", () => {
    const matrix = Object.fromEntries(
      ROLES.map((role) => [
        role,
        operations.filter(([name]) => can(role, name)).map(([name]) => name),
      ]),
    )
    expect(matrix).toMatchSnapshot()
  })
})
