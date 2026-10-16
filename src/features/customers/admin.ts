import "server-only"
import { sql } from "drizzle-orm"
import { z } from "zod"

import type { Actor } from "@/server/auth/actor"
import { rolesAllow } from "@/server/auth/permissions"
import { STAFF_ROLES } from "@/server/auth/roles"
import { writeAudit } from "@/server/audit"
import { getDb } from "@/server/db/client"
import { withTransaction } from "@/server/db/transaction"
import { DomainError } from "@/server/errors"
import { defineOperation } from "@/server/operation"

/**
 * Staff view of customers (doc/06 Phase 4 §10). Spend figures need
 * `order: read_financials`; the wallet ledger is shown to anyone who can
 * read customers, because support explains it to them.
 */

export const ADMIN_CUSTOMERS_PAGE_SIZE = 50

const seesMoney = (actor: Actor) =>
  actor.kind === "system" ||
  (actor.kind === "user" &&
    rolesAllow(actor.roles, { order: ["read_financials"] }))

// Anyone without a staff role is a customer.
const NOT_STAFF = sql`(u.role is null or not (regexp_split_to_array(trim(u.role), '\\s*,\\s*') && ${`{${STAFF_ROLES.join(",")}}`}::text[]))`
const PLACED = sql`status not in ('pending_payment', 'expired', 'cancelled')`

export type AdminCustomerRow = {
  id: string
  name: string
  email: string | null
  phone: string | null
  orderCount: number
  spentPaise: number | null
  codBlocked: boolean
  joinedAt: Date
}

export const adminListCustomers = defineOperation({
  name: "customers.adminList",
  access: { customer: ["read"] },
  input: z.object({
    q: z.string().trim().max(100).optional(),
    codBlocked: z.boolean().optional(),
    page: z.number().int().min(1).max(10_000).default(1),
  }),
  async handler({ actor }, input) {
    const like = input.q ? `%${input.q.replace(/[%_\\]/g, "\\$&")}%` : null
    const rows = await getDb().execute<{
      id: string
      name: string
      email: string
      phone_number: string | null
      order_count: number
      spent: number
      cod_blocked: boolean | null
      created_at: Date
      total: number
    }>(sql`
      select u.id, u.name, u.email, u.phone_number, u.created_at, cp.cod_blocked,
             (select count(*)::int from orders o where o.user_id = u.id and ${PLACED}) as order_count,
             (select coalesce(sum(total_paise), 0)::int from orders o where o.user_id = u.id and ${PLACED}) as spent,
             count(*) over ()::int as total
      from users u left join customer_profiles cp on cp.user_id = u.id
      where ${NOT_STAFF}
        ${input.codBlocked !== undefined ? sql`and coalesce(cp.cod_blocked, false) = ${input.codBlocked}` : sql``}
        ${like ? sql`and (u.name ilike ${like} or u.email ilike ${like} or u.phone_number ilike ${like})` : sql``}
      order by u.created_at desc
      limit ${ADMIN_CUSTOMERS_PAGE_SIZE} offset ${(input.page - 1) * ADMIN_CUSTOMERS_PAGE_SIZE}`)
    const money = seesMoney(actor)
    return {
      total: rows.rows[0]?.total ?? 0,
      rows: rows.rows.map((r): AdminCustomerRow => ({
        id: r.id,
        name: r.name,
        email: r.email.endsWith(".invalid") ? null : r.email,
        phone: r.phone_number,
        orderCount: r.order_count,
        spentPaise: money ? r.spent : null,
        codBlocked: Boolean(r.cod_blocked),
        joinedAt: new Date(r.created_at),
      })),
    }
  },
})

export type AdminCustomerDetail = {
  id: string
  name: string
  email: string | null
  emailVerified: boolean
  phone: string | null
  phoneVerified: boolean
  joinedAt: Date
  codBlocked: boolean
  codBlockedReason: string | null
  marketingEmail: boolean
  deletionRequestedAt: Date | null
  spentPaise: number | null
  addresses: {
    fullName: string
    phone: string
    line: string
    isDefault: boolean
  }[]
  orders: {
    orderNumber: string
    status: string
    paymentMode: string
    totalPaise: number | null
    placedAt: Date
  }[]
  wallet: {
    balancePaise: number
    entries: {
      amountPaise: number
      reason: string
      note: string | null
      expiresAt: Date | null
      at: Date
    }[]
  }
}

export const adminGetCustomer = defineOperation({
  name: "customers.adminGet",
  access: { customer: ["read"] },
  input: z.object({ userId: z.uuid() }),
  async handler({ actor }, { userId }): Promise<AdminCustomerDetail> {
    const db = getDb()
    const found = await db.execute<{
      id: string
      name: string
      email: string
      email_verified: boolean
      phone_number: string | null
      phone_number_verified: boolean | null
      created_at: Date
      cod_blocked: boolean | null
      cod_blocked_reason: string | null
      marketing_email_consent_at: Date | null
      deletion_requested_at: Date | null
    }>(sql`
      select u.id, u.name, u.email, u.email_verified, u.phone_number, u.phone_number_verified, u.created_at,
             cp.cod_blocked, cp.cod_blocked_reason, cp.marketing_email_consent_at, cp.deletion_requested_at
      from users u left join customer_profiles cp on cp.user_id = u.id
      where u.id = ${userId} and ${NOT_STAFF}`)
    const u = found.rows[0]
    if (!u) throw new DomainError("NOT_FOUND", "Customer not found.")
    const money = seesMoney(actor)
    const [addresses, orders, balance, entries] = await Promise.all([
      db.execute<{
        full_name: string
        phone: string
        line1: string
        line2: string | null
        city: string
        postal_code: string
        country_code: string
        is_default: boolean
      }>(sql`
        select full_name, phone, line1, line2, city, postal_code, country_code, is_default
        from addresses where user_id = ${userId} order by is_default desc, created_at desc`),
      db.execute<{
        order_number: string
        status: string
        payment_mode: string
        total_paise: number
        placed_at: Date
      }>(sql`
        select order_number, status, payment_mode, total_paise, placed_at from orders
        where user_id = ${userId} and status <> 'expired' order by placed_at desc limit 50`),
      db.execute<{ balance: number }>(sql`
        select coalesce(sum(remaining_paise), 0)::int as balance from wallet_credit_lots
        where user_id = ${userId} and remaining_paise > 0 and (expires_at is null or expires_at > now())`),
      db.execute<{
        amount_paise: number
        reason: string
        note: string | null
        expires_at: Date | null
        created_at: Date
      }>(sql`
        select amount_paise, reason, note, expires_at, created_at from wallet_ledger
        where user_id = ${userId} order by created_at desc limit 50`),
    ])
    const placed = orders.rows.filter(
      (o) => !["pending_payment", "cancelled"].includes(o.status),
    )
    return {
      id: u.id,
      name: u.name,
      email: u.email.endsWith(".invalid") ? null : u.email,
      emailVerified: u.email_verified,
      phone: u.phone_number,
      phoneVerified: Boolean(u.phone_number_verified),
      joinedAt: new Date(u.created_at),
      codBlocked: Boolean(u.cod_blocked),
      codBlockedReason: u.cod_blocked_reason,
      marketingEmail: Boolean(u.marketing_email_consent_at),
      deletionRequestedAt: u.deletion_requested_at
        ? new Date(u.deletion_requested_at)
        : null,
      spentPaise: money
        ? placed.reduce((sum, o) => sum + o.total_paise, 0)
        : null,
      addresses: addresses.rows.map((a) => ({
        fullName: a.full_name,
        phone: a.phone,
        line: [a.line1, a.line2, a.city, a.postal_code, a.country_code]
          .filter(Boolean)
          .join(", "),
        isDefault: a.is_default,
      })),
      orders: orders.rows.map((o) => ({
        orderNumber: o.order_number,
        status: o.status,
        paymentMode: o.payment_mode,
        totalPaise: money ? o.total_paise : null,
        placedAt: new Date(o.placed_at),
      })),
      wallet: {
        balancePaise: balance.rows[0]!.balance,
        entries: entries.rows.map((e) => ({
          amountPaise: e.amount_paise,
          reason: e.reason,
          note: e.note,
          expiresAt: e.expires_at ? new Date(e.expires_at) : null,
          at: new Date(e.created_at),
        })),
      },
    }
  },
})

/** Blocks or allows cash on delivery for one customer (doc/03 §2). */
export const setCodBlock = defineOperation({
  name: "customers.setCodBlock",
  access: { customer: ["update"] },
  input: z
    .object({
      userId: z.uuid(),
      blocked: z.boolean(),
      reason: z.string().trim().max(300).optional(),
    })
    .refine((v) => !v.blocked || (v.reason?.length ?? 0) >= 3, {
      path: ["reason"],
      message: "Give a reason for blocking COD.",
    }),
  async handler({ actor }, input) {
    return withTransaction(async (tx) => {
      const exists = await tx.execute<{ id: string }>(
        sql`select id from users u where id = ${input.userId} and ${NOT_STAFF}`,
      )
      if (!exists.rows[0])
        throw new DomainError("NOT_FOUND", "Customer not found.")
      await tx.execute(sql`
        insert into customer_profiles (user_id, cod_blocked, cod_blocked_reason)
        values (${input.userId}, ${input.blocked}, ${input.blocked ? input.reason! : null})
        on conflict (user_id) do update set cod_blocked = excluded.cod_blocked,
          cod_blocked_reason = excluded.cod_blocked_reason, updated_at = now()`)
      await writeAudit(tx, actor, {
        action: input.blocked ? "customer.block_cod" : "customer.allow_cod",
        entityType: "user",
        entityId: input.userId,
        changes: { reason: input.reason },
      })
      return {}
    })
  },
})
