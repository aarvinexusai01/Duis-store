import { createAccessControl } from "better-auth/plugins/access"
import { defaultStatements } from "better-auth/plugins/admin/access"

import type { RoleName } from "./roles"

/**
 * Every permission in the system, defined in code (ADR-003). Better Auth's
 * admin plugin contributes `user` and `session`; the rest are ours.
 * The full role × permission matrix is checked by
 * tests/integration/rbac.test.ts and documented in doc/08 §2.
 */
export const statements = {
  ...defaultStatements,
  catalog: ["read", "create", "update", "publish", "archive"],
  inventory: ["read", "adjust"],
  collection: ["read", "create", "update", "publish", "archive"],
  media: ["read", "upload", "update", "delete"],
  order: [
    "read",
    "read_financials",
    "update",
    "fulfil",
    "cancel",
    "refund",
    "export",
  ],
  exchange: ["read", "decide", "process"],
  discount: ["read", "create", "update", "archive"],
  customer: ["read", "update", "credit"],
  review: ["read", "moderate"],
  cms: ["read", "draft", "review", "publish", "archive"],
  settings: ["read", "update"],
  report: ["read", "export"],
  staff: ["read", "manage"],
  audit: ["read"],
  system: ["read", "operate"],
} as const

type Statements = typeof statements
export type Resource = keyof Statements
export type PermissionRequest = {
  [R in Resource]?: Statements[R][number][]
}

export const ac = createAccessControl(statements)

const all = <R extends Resource>(resource: R) => [...statements[resource]]

export const roleDefinitions = {
  super_admin: ac.newRole({
    // Everything except impersonation, which no role is given.
    user: [
      "create",
      "list",
      "set-role",
      "ban",
      "delete",
      "set-password",
      "set-email",
      "get",
      "update",
    ],
    session: all("session"),
    catalog: all("catalog"),
    inventory: all("inventory"),
    collection: all("collection"),
    media: all("media"),
    order: all("order"),
    exchange: all("exchange"),
    discount: all("discount"),
    customer: all("customer"),
    review: all("review"),
    cms: all("cms"),
    settings: all("settings"),
    report: all("report"),
    staff: all("staff"),
    audit: all("audit"),
    system: all("system"),
  }),
  store_admin: ac.newRole({
    catalog: all("catalog"),
    inventory: all("inventory"),
    collection: all("collection"),
    media: all("media"),
    order: all("order"),
    exchange: all("exchange"),
    discount: all("discount"),
    customer: all("customer"),
    review: all("review"),
    cms: ["read"],
    settings: all("settings"),
    report: all("report"),
    staff: ["read"],
    audit: ["read"],
    system: ["read"],
  }),
  content_manager: ac.newRole({
    cms: all("cms"),
    media: all("media"),
    catalog: ["read"],
    collection: ["read"],
  }),
  content_editor: ac.newRole({
    cms: ["read", "draft"],
    media: ["read", "upload", "update"],
    catalog: ["read"],
    collection: ["read"],
  }),
  fulfilment_staff: ac.newRole({
    order: ["read", "fulfil"],
    exchange: ["read", "process"],
    inventory: ["read"],
    catalog: ["read"],
  }),
  support_agent: ac.newRole({
    order: ["read", "update", "cancel"],
    exchange: ["read", "decide", "process"],
    customer: ["read", "update"],
    review: ["read", "moderate"],
    inventory: ["read"],
    catalog: ["read"],
  }),
  customer: ac.newRole({}),
} satisfies Record<RoleName, unknown>

/** True when any of the roles grants every action in the request. */
export function rolesAllow(
  roles: readonly RoleName[],
  request: PermissionRequest,
): boolean {
  return roles.some(
    (role) =>
      roleDefinitions[role].authorize(
        request as Parameters<
          (typeof roleDefinitions)[typeof role]["authorize"]
        >[0],
      ).success,
  )
}
