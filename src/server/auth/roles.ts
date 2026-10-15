/**
 * The seven roles from doc/01 decision 23. Better Auth stores a user's roles
 * as a comma-separated string in `users.role`.
 */
export const ROLES = [
  "super_admin",
  "store_admin",
  "content_manager",
  "content_editor",
  "fulfilment_staff",
  "support_agent",
  "customer",
] as const

export type RoleName = (typeof ROLES)[number]

export const STAFF_ROLES = ROLES.filter(
  (role): role is Exclude<RoleName, "customer"> => role !== "customer",
)

const known = new Set<string>(ROLES)

export function parseRoles(value: string | null | undefined): RoleName[] {
  const roles = (value ?? "")
    .split(",")
    .map((role) => role.trim())
    .filter((role): role is RoleName => known.has(role))
  return roles.length > 0 ? [...new Set(roles)] : ["customer"]
}

export function isStaff(roles: readonly RoleName[]): boolean {
  return roles.some((role) => role !== "customer")
}
