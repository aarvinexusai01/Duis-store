import "server-only"
import { createHash, randomBytes } from "node:crypto"

import { sql } from "drizzle-orm"
import { z } from "zod"

import { getServerEnv } from "@/config/env"
import type { Actor } from "@/server/auth/actor"
import { getAuth } from "@/server/auth/auth"
import { parseRoles, STAFF_ROLES, type RoleName } from "@/server/auth/roles"
import { writeAudit } from "@/server/audit"
import { getDb } from "@/server/db/client"
import { withTransaction, type Transaction } from "@/server/db/transaction"
import { DomainError } from "@/server/errors"
import { queueEmail } from "@/server/notifications/email"
import { defineOperation } from "@/server/operation"

/**
 * Staff management (doc/06 Phase 4 §11), Super Admin only. People join by
 * email invitation (owner decision 2026-10-16), choose their own password
 * and then set up 2FA. The store always keeps at least one active Super
 * Admin with two-factor authentication.
 */

const INVITE_HOURS = 72
const staffRole = z.enum(STAFF_ROLES as unknown as [RoleName, ...RoleName[]])
export const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  store_admin: "Store Admin",
  content_manager: "Content Manager",
  content_editor: "Content Editor",
  fulfilment_staff: "Fulfilment Staff",
  support_agent: "Support Agent",
}

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex")
const STAFF = sql`(u.role is not null and regexp_split_to_array(trim(u.role), '\\s*,\\s*') && ${`{${STAFF_ROLES.join(",")}}`}::text[])`
const userIdOf = (actor: Actor) => (actor.kind === "user" ? actor.userId : null)

export type StaffMember = {
  id: string
  name: string
  email: string
  roles: RoleName[]
  twoFactorEnabled: boolean
  active: boolean
  lastSeenAt: Date | null
  sessions: number
}

export type PendingInvitation = {
  id: string
  email: string
  roles: string[]
  invitedBy: string | null
  expiresAt: Date
}

export const listStaff = defineOperation({
  name: "staff.list",
  access: { staff: ["read"] },
  input: z.object({}),
  async handler() {
    const db = getDb()
    const [members, invitations] = await Promise.all([
      db.execute<{
        id: string
        name: string
        email: string
        role: string
        two_factor_enabled: boolean | null
        banned: boolean | null
        last_seen: Date | null
        sessions: number
      }>(sql`
        select u.id, u.name, u.email, u.role, u.two_factor_enabled, u.banned,
               (select max(s.updated_at) from sessions s where s.user_id = u.id) as last_seen,
               (select count(*)::int from sessions s where s.user_id = u.id and s.expires_at > now()) as sessions
        from users u where ${STAFF} order by u.name`),
      db.execute<{
        id: string
        email: string
        roles: string[]
        invited_by: string | null
        expires_at: Date
      }>(sql`
        select i.id, i.email::text, i.roles, u.name as invited_by, i.expires_at
        from staff_invitations i left join users u on u.id = i.invited_by
        where i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
        order by i.created_at desc`),
    ])
    return {
      members: members.rows.map((m): StaffMember => ({
        id: m.id,
        name: m.name,
        email: m.email,
        roles: parseRoles(m.role),
        twoFactorEnabled: Boolean(m.two_factor_enabled),
        active: !m.banned,
        lastSeenAt: m.last_seen ? new Date(m.last_seen) : null,
        sessions: m.sessions,
      })),
      invitations: invitations.rows.map((i): PendingInvitation => ({
        id: i.id,
        email: i.email,
        roles: i.roles,
        invitedBy: i.invited_by,
        expiresAt: new Date(i.expires_at),
      })),
    }
  },
})

export const inviteStaff = defineOperation({
  name: "staff.invite",
  access: { staff: ["manage"] },
  input: z.object({
    email: z.email().trim().toLowerCase(),
    roles: z.array(staffRole).min(1).max(STAFF_ROLES.length),
  }),
  async handler({ actor }, input) {
    const token = randomBytes(32).toString("base64url")
    const expiresAt = new Date(Date.now() + INVITE_HOURS * 3600_000)
    await withTransaction(async (tx) => {
      const existing = await tx.execute<{ role: string | null }>(
        sql`select role from users where lower(email) = ${input.email}`,
      )
      const current = existing.rows[0]
      if (current && parseRoles(current.role).some((r) => r !== "customer")) {
        throw new DomainError(
          "CONFLICT",
          "That person is already staff. Change their roles in the list instead.",
        )
      }
      // A new invitation replaces any earlier one for the same address.
      await tx.execute(sql`
        update staff_invitations set revoked_at = now()
        where email = ${input.email} and accepted_at is null and revoked_at is null`)
      const created = await tx.execute<{ id: string }>(sql`
        insert into staff_invitations (email, roles, token_hash, invited_by, expires_at)
        values (${input.email}, ${`{${[...new Set(input.roles)].join(",")}}`}::text[], ${hashToken(token)},
                ${userIdOf(actor)}, ${expiresAt})
        returning id`)
      const inviter = await tx.execute<{ name: string }>(
        sql`select name from users where id = ${userIdOf(actor)}`,
      )
      await queueEmail(
        {
          template: "staff-invite",
          to: input.email,
          reference: { type: "staff_invitation", id: created.rows[0]!.id },
          props: {
            invitedBy: inviter.rows[0]?.name ?? "The Duis team",
            roles: input.roles.map((r) => ROLE_LABEL[r]).join(", "),
            url: new URL(
              `/admin/join?token=${token}`,
              getServerEnv().APP_URL,
            ).toString(),
            expires: expiresAt.toLocaleString("en-IN", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: "Asia/Kolkata",
            }),
          },
        },
        { tx },
      )
      await writeAudit(tx, actor, {
        action: "staff.invite",
        entityType: "staff_invitation",
        entityId: created.rows[0]!.id,
        changes: { email: input.email, roles: input.roles },
      })
    })
    return { expiresAt }
  },
})

export const revokeInvitation = defineOperation({
  name: "staff.revokeInvitation",
  access: { staff: ["manage"] },
  input: z.object({ id: z.uuid() }),
  async handler({ actor }, { id }) {
    return withTransaction(async (tx) => {
      const updated = await tx.execute<{ id: string }>(sql`
        update staff_invitations set revoked_at = now()
        where id = ${id} and accepted_at is null and revoked_at is null returning id`)
      if (!updated.rows[0])
        throw new DomainError("NOT_FOUND", "Invitation not found.")
      await writeAudit(tx, actor, {
        action: "staff.revoke_invitation",
        entityType: "staff_invitation",
        entityId: id,
      })
      return {}
    })
  },
})

type InvitationRow = {
  id: string
  email: string
  roles: string[]
  expires_at: Date
  accepted_at: Date | null
  revoked_at: Date | null
}

async function findInvitation(
  db: Transaction | ReturnType<typeof getDb>,
  token: string,
  lock = false,
): Promise<InvitationRow | null> {
  const found = await db.execute<InvitationRow>(sql`
    select id, email::text, roles, expires_at, accepted_at, revoked_at from staff_invitations
    where token_hash = ${hashToken(token)} ${lock ? sql`for update` : sql``}`)
  return found.rows[0] ?? null
}

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{40,60}$/)

export type InvitationView =
  | { status: "invalid" | "expired" | "used" }
  | {
      status: "valid"
      email: string
      roles: string[]
      hasAccount: boolean
    }

/** What the join page shows; the token itself is the credential. */
export const getInvitation = defineOperation({
  name: "staff.getInvitation",
  access: "public",
  input: z.object({ token: z.string().max(100) }),
  async handler(_ctx, { token }): Promise<InvitationView> {
    if (!tokenSchema.safeParse(token).success) return { status: "invalid" }
    const invitation = await findInvitation(getDb(), token)
    if (!invitation || invitation.revoked_at) return { status: "invalid" }
    if (invitation.accepted_at) return { status: "used" }
    if (new Date(invitation.expires_at).getTime() < Date.now())
      return { status: "expired" }
    const account = await getDb().execute<{ id: string }>(
      sql`select id from users where lower(email) = ${invitation.email}`,
    )
    return {
      status: "valid",
      email: invitation.email,
      roles: invitation.roles.map((r) => ROLE_LABEL[r] ?? r),
      hasAccount: Boolean(account.rows[0]),
    }
  },
})

/**
 * Accepts an invitation. Someone new chooses a name and password and the
 * account is created verified (the link proved the address). Someone with an
 * account already must be signed in as it; they keep their password.
 */
export const acceptInvitation = defineOperation({
  name: "staff.acceptInvitation",
  access: "public",
  input: z.object({
    token: tokenSchema,
    name: z.string().trim().min(2).max(100).optional(),
    password: z.string().min(10).max(128).optional(),
  }),
  async handler({ actor }, input) {
    const invitation = await findInvitation(getDb(), input.token)
    if (
      !invitation ||
      invitation.revoked_at ||
      invitation.accepted_at ||
      new Date(invitation.expires_at).getTime() < Date.now()
    ) {
      throw new DomainError(
        "INVALID_STATE",
        "This invitation has expired or was already used. Ask for a new one.",
      )
    }
    const existing = await getDb().execute<{ id: string }>(
      sql`select id from users where lower(email) = ${invitation.email}`,
    )
    let userId = existing.rows[0]?.id
    if (userId) {
      if (actor.kind !== "user" || actor.userId !== userId) {
        throw new DomainError(
          "UNAUTHENTICATED",
          `Sign in as ${invitation.email} first, then open the link again.`,
        )
      }
    } else {
      if (!input.name || !input.password) {
        throw new DomainError(
          "VALIDATION_FAILED",
          "Choose your name and a password.",
          {
            issues: {
              ...(input.name ? {} : { name: ["Enter your name."] }),
              ...(input.password
                ? {}
                : { password: ["At least 10 characters."] }),
            },
          },
        )
      }
      const created = await getAuth().api.createUser({
        body: {
          email: invitation.email,
          password: input.password,
          name: input.name,
          role: "customer",
          data: { emailVerified: true },
        },
      })
      userId = created.user.id
    }
    await withTransaction(async (tx) => {
      const locked = await findInvitation(tx, input.token, true)
      if (!locked || locked.accepted_at || locked.revoked_at) {
        throw new DomainError(
          "INVALID_STATE",
          "This invitation was already used.",
        )
      }
      await tx.execute(sql`
        update users set role = ${invitation.roles.join(",")}, email_verified = true, updated_at = now()
        where id = ${userId}`)
      await tx.execute(sql`
        update staff_invitations set accepted_at = now(), accepted_user_id = ${userId}
        where id = ${invitation.id}`)
      await writeAudit(
        tx,
        { ...actorFor(actor, userId!) },
        {
          action: "staff.accept_invitation",
          entityType: "user",
          entityId: userId!,
          changes: { roles: invitation.roles },
        },
      )
    })
    return { email: invitation.email, newAccount: !existing.rows[0] }
  },
})

// The audit entry names the person who accepted, even before they sign in.
function actorFor(actor: Actor, userId: string): Actor {
  return actor.kind === "user"
    ? actor
    : {
        kind: "user",
        userId,
        roles: ["customer"],
        twoFactorEnabled: false,
        requestId: actor.requestId,
        ip: actor.kind === "anonymous" ? actor.ip : null,
      }
}

/**
 * Refuses a change that would leave no active Super Admin with 2FA, so the
 * store can never lock itself out of staff management.
 */
async function keepASuperAdmin(tx: Transaction, losingUserId: string) {
  const others = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from users u
    where u.id <> ${losingUserId} and coalesce(u.banned, false) = false
      and coalesce(u.two_factor_enabled, false) = true
      and 'super_admin' = any(regexp_split_to_array(trim(u.role), '\\s*,\\s*'))`)
  if (others.rows[0]!.n === 0) {
    throw new DomainError(
      "CONFLICT",
      "There must always be another active Super Admin with two-factor authentication.",
    )
  }
}

async function loadStaff(tx: Transaction, userId: string) {
  const found = await tx.execute<{ role: string | null; email: string }>(
    sql`select role, email from users where id = ${userId} for update`,
  )
  const row = found.rows[0]
  if (!row) throw new DomainError("NOT_FOUND", "Person not found.")
  return { roles: parseRoles(row.role), email: row.email }
}

/** Sets a person's staff roles; an empty list makes them a customer again. */
export const setStaffRoles = defineOperation({
  name: "staff.setRoles",
  access: { staff: ["manage"] },
  input: z.object({
    userId: z.uuid(),
    roles: z.array(staffRole).max(STAFF_ROLES.length),
  }),
  async handler({ actor }, input) {
    return withTransaction(async (tx) => {
      const current = await loadStaff(tx, input.userId)
      const next = [...new Set(input.roles)]
      if (
        current.roles.includes("super_admin") &&
        !next.includes("super_admin")
      ) {
        await keepASuperAdmin(tx, input.userId)
      }
      await tx.execute(sql`
        update users set role = ${next.length > 0 ? next.join(",") : "customer"}, updated_at = now()
        where id = ${input.userId}`)
      if (next.length === 0) {
        await tx.execute(
          sql`delete from sessions where user_id = ${input.userId}`,
        )
      }
      await writeAudit(tx, actor, {
        action: "staff.set_roles",
        entityType: "user",
        entityId: input.userId,
        changes: { from: current.roles, to: next },
      })
      return {}
    })
  },
})

/**
 * Clears a person's 2FA (lost phone): they set it up again at next sign-in.
 * All their sessions end now.
 */
export const resetStaffTwoFactor = defineOperation({
  name: "staff.resetTwoFactor",
  access: { staff: ["manage"] },
  input: z.object({ userId: z.uuid() }),
  async handler({ actor }, { userId }) {
    if (userIdOf(actor) === userId) {
      throw new DomainError(
        "INVALID_STATE",
        "Ask another Super Admin to reset your own two-factor.",
      )
    }
    return withTransaction(async (tx) => {
      const current = await loadStaff(tx, userId)
      if (current.roles.includes("super_admin"))
        await keepASuperAdmin(tx, userId)
      await tx.execute(sql`delete from two_factors where user_id = ${userId}`)
      await tx.execute(
        sql`update users set two_factor_enabled = false, updated_at = now() where id = ${userId}`,
      )
      await tx.execute(sql`delete from sessions where user_id = ${userId}`)
      await writeAudit(tx, actor, {
        action: "staff.reset_two_factor",
        entityType: "user",
        entityId: userId,
      })
      return {}
    })
  },
})

/** Deactivates (signs out and blocks sign-in) or reactivates a staff account. */
export const setStaffActive = defineOperation({
  name: "staff.setActive",
  access: { staff: ["manage"] },
  input: z.object({
    userId: z.uuid(),
    active: z.boolean(),
    reason: z.string().trim().max(300).optional(),
  }),
  async handler({ actor }, input) {
    if (!input.active && userIdOf(actor) === input.userId) {
      throw new DomainError("INVALID_STATE", "You can't deactivate yourself.")
    }
    return withTransaction(async (tx) => {
      const current = await loadStaff(tx, input.userId)
      if (!input.active && current.roles.includes("super_admin"))
        await keepASuperAdmin(tx, input.userId)
      await tx.execute(sql`
        update users set banned = ${!input.active}, ban_reason = ${input.active ? null : (input.reason ?? "Deactivated by a Super Admin")},
          updated_at = now()
        where id = ${input.userId}`)
      if (!input.active) {
        await tx.execute(
          sql`delete from sessions where user_id = ${input.userId}`,
        )
      }
      await writeAudit(tx, actor, {
        action: input.active ? "staff.reactivate" : "staff.deactivate",
        entityType: "user",
        entityId: input.userId,
        changes: { reason: input.reason },
      })
      return {}
    })
  },
})

export const revokeStaffSessions = defineOperation({
  name: "staff.revokeSessions",
  access: { staff: ["manage"] },
  input: z.object({ userId: z.uuid() }),
  async handler({ actor }, { userId }) {
    return withTransaction(async (tx) => {
      await loadStaff(tx, userId)
      const removed = await tx.execute<{ id: string }>(
        sql`delete from sessions where user_id = ${userId} returning id`,
      )
      await writeAudit(tx, actor, {
        action: "staff.revoke_sessions",
        entityType: "user",
        entityId: userId,
        changes: { sessions: removed.rows.length },
      })
      return { sessions: removed.rows.length }
    })
  },
})
