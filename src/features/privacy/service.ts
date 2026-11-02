import "server-only"
import { sql } from "drizzle-orm"
import { z } from "zod"

import { hideCustomerReviews } from "@/features/reviews"
import { spendableBalance } from "@/features/wallet"
import { CONSENT_PURPOSES, type ConsentPurpose } from "@/lib/privacy"
import type { Actor } from "@/server/auth/actor"
import { parseRoles } from "@/server/auth/roles"
import { writeAudit } from "@/server/audit"
import { getDb } from "@/server/db/client"
import { withTransaction, type Transaction } from "@/server/db/transaction"
import { DomainError } from "@/server/errors"
import { queueEmail } from "@/server/notifications/email"
import { defineOperation } from "@/server/operation"
import { deletePrivateFile } from "@/server/storage/private"
import {
  consentFields,
  hasCurrentConsent,
  recordConsents,
} from "@/server/privacy"

/**
 * A signed-in customer who hasn't seen this notice version ticks the account
 * and age boxes once (Act s.5(2), doc/06 Phase 12).
 */
export const acceptAccountNotice = defineOperation({
  name: "privacy.acceptAccountNotice",
  access: "authenticated",
  input: z.object(consentFields),
  async handler({ actor }, { consentLanguage }) {
    if (actor.kind !== "user")
      throw new DomainError("UNAUTHENTICATED", "Please sign in to continue.")
    if (await hasCurrentConsent(getDb(), actor.userId, "account")) return
    await recordConsents(getDb(), {
      userId: actor.userId,
      purposes: ["account", "age"],
      source: "notice_prompt",
      language: consentLanguage,
    })
  },
})

// --- My account → Privacy & data (Act s.6(4), s.11–14) ---------------------

/** Purposes that can be withdrawn with one click, and what that does. */
const WITHDRAWABLE = [
  "marketing",
  "marketing_whatsapp",
  "whatsapp_updates",
  "stock_alert",
  "review",
  "address",
] as const
type Withdrawable = (typeof WITHDRAWABLE)[number]

export type PrivacyOverview = {
  consents: {
    purpose: ConsentPurpose
    granted: boolean
    at: Date | null
    canWithdraw: boolean
  }[]
  history: {
    purpose: ConsentPurpose
    granted: boolean
    noticeVersion: string
    language: string
    source: string
    at: Date
  }[]
  nominee: { name: string; contact: string } | null
  deletionRequestedAt: string | null
}

const userIdOf = (actor: Actor): string => {
  if (actor.kind !== "user")
    throw new DomainError("UNAUTHENTICATED", "Please sign in to continue.")
  return actor.userId
}

export const getPrivacyOverview = defineOperation({
  name: "privacy.overview",
  access: "authenticated",
  input: z.object({}),
  async handler({ actor }): Promise<PrivacyOverview> {
    const userId = userIdOf(actor)
    const db = getDb()
    const [rows, profile] = await Promise.all([
      db.execute<{
        purpose: ConsentPurpose
        granted: boolean
        notice_version: string
        language: string
        source: string
        created_at: Date
      }>(sql`
        select purpose, granted, notice_version, language, source, created_at
        from data_consents where user_id = ${userId} order by created_at desc limit 200`),
      db.execute<{
        email: Date | null
        whatsapp: Date | null
        updates: Date | null
        nominee_name: string | null
        nominee_contact: string | null
        deletion_requested_at: Date | null
      }>(sql`
        select marketing_email_consent_at as email, marketing_whatsapp_consent_at as whatsapp,
          whatsapp_updates_consent_at as updates, nominee_name, nominee_contact, deletion_requested_at
        from customer_profiles where user_id = ${userId}`),
    ])
    const p = profile.rows[0]
    const latest = new Map<ConsentPurpose, (typeof rows.rows)[number]>()
    for (const row of rows.rows) {
      if (!latest.has(row.purpose)) latest.set(row.purpose, row)
    }
    // These switches predate the record, so they are what's really in force.
    const switches: [ConsentPurpose, Date | null | undefined][] = [
      ["marketing", p?.email],
      ["marketing_whatsapp", p?.whatsapp],
      ["whatsapp_updates", p?.updates],
    ]
    const consents: PrivacyOverview["consents"] = [...latest.values()].map(
      (row) => ({
        purpose: row.purpose,
        granted: row.granted,
        at: new Date(row.created_at),
        canWithdraw: false,
      }),
    )
    for (const [purpose, since] of switches) {
      const known = consents.find((consent) => consent.purpose === purpose)
      if (known) known.granted = Boolean(since)
      else if (since) {
        consents.push({
          purpose,
          granted: true,
          at: new Date(since),
          canWithdraw: false,
        })
      }
    }
    for (const consent of consents) {
      consent.canWithdraw =
        consent.granted &&
        (WITHDRAWABLE as readonly string[]).includes(consent.purpose)
    }
    consents.sort(
      (a, b) =>
        CONSENT_PURPOSES.indexOf(a.purpose) -
        CONSENT_PURPOSES.indexOf(b.purpose),
    )
    return {
      consents,
      history: rows.rows.map((row) => ({
        purpose: row.purpose,
        granted: row.granted,
        noticeVersion: row.notice_version,
        language: row.language,
        source: row.source,
        at: new Date(row.created_at),
      })),
      nominee:
        p?.nominee_name && p.nominee_contact
          ? { name: p.nominee_name, contact: p.nominee_contact }
          : null,
      deletionRequestedAt: p?.deletion_requested_at
        ? new Date(p.deletion_requested_at).toISOString()
        : null,
    }
  },
})

/** Stops the use the consent covered, and records the withdrawal. */
export const withdrawConsent = defineOperation({
  name: "privacy.withdrawConsent",
  access: "authenticated",
  input: z.object({ purpose: z.enum(WITHDRAWABLE) }),
  async handler({ actor, log }, { purpose }) {
    const userId = userIdOf(actor)
    await withTransaction(async (tx) => {
      await stopUse(tx, userId, purpose)
      await recordConsents(tx, {
        userId,
        purposes: [purpose],
        granted: false,
        source: "privacy_page",
      })
    })
    log.info({ purpose }, "consent withdrawn")
  },
})

async function stopUse(tx: Transaction, userId: string, purpose: Withdrawable) {
  switch (purpose) {
    case "marketing":
      await tx.execute(sql`
        update customer_profiles set marketing_email_consent_at = null, updated_at = now()
        where user_id = ${userId}`)
      await tx.execute(sql`
        update newsletter_subscribers set status = 'unsubscribed', unsubscribed_at = now(),
          confirm_token_hash = null, updated_at = now()
        where email = (select email from users where id = ${userId})`)
      return
    case "marketing_whatsapp":
      await tx.execute(sql`
        update customer_profiles set marketing_whatsapp_consent_at = null, updated_at = now()
        where user_id = ${userId}`)
      return
    case "whatsapp_updates":
      await tx.execute(sql`
        update customer_profiles set whatsapp_updates_consent_at = null, updated_at = now()
        where user_id = ${userId}`)
      return
    case "stock_alert":
      await tx.execute(sql`
        delete from stock_alerts where user_id = ${userId} and notified_at is null`)
      return
    case "review":
      await hideCustomerReviews(tx, userId)
      return
    case "address":
      await tx.execute(sql`delete from addresses where user_id = ${userId}`)
      return
  }
}

export const setNominee = defineOperation({
  name: "privacy.setNominee",
  access: "authenticated",
  input: z.discriminatedUnion("action", [
    z.object({ action: z.literal("remove") }),
    z.object({
      action: z.literal("save"),
      name: z.string().trim().min(2, "Enter their name.").max(100),
      contact: z
        .string()
        .trim()
        .min(5, "Enter their email or phone number.")
        .max(200),
      ...consentFields,
    }),
  ]),
  async handler({ actor }, input) {
    const userId = userIdOf(actor)
    const name = input.action === "save" ? input.name : null
    const contact = input.action === "save" ? input.contact : null
    await withTransaction(async (tx) => {
      await tx.execute(sql`
        insert into customer_profiles (user_id, nominee_name, nominee_contact)
        values (${userId}, ${name}, ${contact})
        on conflict (user_id) do update set nominee_name = excluded.nominee_name,
          nominee_contact = excluded.nominee_contact, updated_at = now()`)
      await recordConsents(tx, {
        userId,
        purposes: ["nominee"],
        granted: input.action === "save",
        source: "privacy_page",
        language: input.action === "save" ? input.consentLanguage : "en",
      })
    })
  },
})

/** Everything the shop holds on the customer, in one JSON file (s.11). */
export const exportMyData = defineOperation({
  name: "privacy.exportMyData",
  access: "authenticated",
  input: z.object({}),
  async handler({ actor }) {
    const userId = userIdOf(actor)
    const db = getDb()
    const rows = async <T extends Record<string, unknown>>(
      query: ReturnType<typeof sql>,
    ) => (await db.execute<T>(query)).rows
    const [account] = await rows(sql`
      select name, case when email like '%.invalid' then null else email end as email,
        phone_number, created_at from users where id = ${userId}`)
    const [preferences] = await rows(sql`
      select marketing_email_consent_at, marketing_whatsapp_consent_at, whatsapp_updates_consent_at,
        nominee_name, nominee_contact, deletion_requested_at
      from customer_profiles where user_id = ${userId}`)
    const [
      addresses,
      orders,
      exchanges,
      reviews,
      contactMessages,
      stockAlerts,
      wallet,
      wishlist,
      consents,
    ] = await Promise.all([
      rows(sql`
        select full_name, phone, line1, line2, landmark, city, region, state_code, postal_code,
          country_code, type, is_default from addresses where user_id = ${userId}`),
      rows(sql`
        select o.order_number, o.status, o.payment_status, o.payment_mode, o.total_paise, o.cod_due_paise,
          o.customer_name, o.customer_email, o.customer_phone, o.shipping_address, o.placed_at,
          (select coalesce(json_agg(json_build_object('title', i.title, 'variant', i.variant_label,
             'quantity', i.quantity, 'total_paise', i.line_total_paise)), '[]'::json)
           from order_items i where i.order_id = o.id) as items,
          (select coalesce(json_agg(json_build_object('courier', s.courier_name, 'awb', s.awb, 'status', s.status)), '[]'::json)
           from shipments s where s.order_id = o.id) as parcels
        from orders o where o.user_id = ${userId} order by o.placed_at desc`),
      rows(sql`
        select exchange_number, status, reason, customer_note, created_at
        from exchange_requests where user_id = ${userId} order by created_at desc`),
      rows(sql`
        select r.rating, r.title, r.body, r.fit, r.display_name, r.status, r.created_at, p.title as product
        from reviews r join products p on p.id = r.product_id
        where r.user_id = ${userId} order by r.created_at desc`),
      rows(sql`
        select name, email, phone, order_number, topic, message, created_at
        from contact_messages where user_id = ${userId} order by created_at desc`),
      rows(sql`
        select email, notified_at, created_at from stock_alerts where user_id = ${userId}`),
      rows(sql`
        select amount_paise, reason, note, created_at
        from wallet_ledger where user_id = ${userId} order by created_at desc`),
      rows(sql`
        select p.title as product, w.created_at from wishlist_items w
        join products p on p.id = w.product_id where w.user_id = ${userId}`),
      rows(sql`
        select purpose, granted, notice_version, language, source, created_at
        from data_consents where user_id = ${userId} order by created_at desc`),
    ])
    return {
      exportedAt: new Date().toISOString(),
      account,
      preferences: preferences ?? null,
      addresses,
      orders,
      exchanges,
      reviews,
      contactMessages,
      stockAlerts,
      wallet,
      wishlist,
      consents,
    }
  },
})

// --- Staff: data requests and deletion ---------------------------------------

// The Terms promise a resolution within one month (Consumer Protection Rules).
const RESOLVE_DAYS = 30

export type DataRequests = {
  deletions: {
    userId: string
    name: string
    requestedAt: Date
    dueAt: Date
  }[]
  messages: {
    id: string
    name: string
    status: string
    receivedAt: Date
    dueAt: Date
  }[]
}

export const adminDataRequests = defineOperation({
  name: "privacy.adminDataRequests",
  access: { customer: ["read"] },
  input: z.object({}),
  async handler(): Promise<DataRequests> {
    const db = getDb()
    const due = (from: Date) =>
      new Date(new Date(from).getTime() + RESOLVE_DAYS * 86_400_000)
    const [deletions, messages] = await Promise.all([
      db.execute<{ id: string; name: string; at: Date }>(sql`
        select u.id, u.name, p.deletion_requested_at as at
        from customer_profiles p join users u on u.id = p.user_id
        where p.deletion_requested_at is not null and p.erased_at is null
        order by p.deletion_requested_at`),
      db.execute<{ id: string; name: string; status: string; at: Date }>(sql`
        select id, name, status, created_at as at from contact_messages
        where topic = 'privacy' and status <> 'closed' order by created_at`),
    ])
    return {
      deletions: deletions.rows.map((row) => ({
        userId: row.id,
        name: row.name,
        requestedAt: new Date(row.at),
        dueAt: due(row.at),
      })),
      messages: messages.rows.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        receivedAt: new Date(row.at),
        dueAt: due(row.at),
      })),
    }
  },
})

const ERASED_NAME = "Deleted customer"

/**
 * Completes a customer's deletion request (Act s.12), irreversibly. Personal
 * data goes; order lines, amounts, place of supply and the invoices stay for
 * the GST records (72 months, doc/08). The user row stays, as orders, the
 * wallet ledger and the consent proof refer to it, but nobody can sign in.
 */
export const eraseCustomer = defineOperation({
  name: "privacy.eraseCustomer",
  access: { customer: ["erase"] },
  input: z.object({ userId: z.uuid() }),
  async handler({ actor, log }, { userId }) {
    const files = await withTransaction(async (tx) => {
      const found = await tx.execute<{
        name: string
        email: string
        role: string | null
        requested: Date | null
        erased: Date | null
      }>(sql`
        select u.name, u.email, u.role, p.deletion_requested_at as requested, p.erased_at as erased
        from users u left join customer_profiles p on p.user_id = u.id
        where u.id = ${userId} for no key update of u`)
      const user = found.rows[0]
      if (!user) throw new DomainError("NOT_FOUND", "Customer not found.")
      if (parseRoles(user.role).some((role) => role !== "customer")) {
        throw new DomainError(
          "CONFLICT",
          "This is a staff account. Remove its staff roles first.",
        )
      }
      if (user.erased) {
        throw new DomainError(
          "INVALID_STATE",
          "This account is already deleted.",
        )
      }
      if (!user.requested) {
        throw new DomainError(
          "INVALID_STATE",
          "The customer hasn't asked for deletion.",
        )
      }
      const open = await tx.execute<{
        orders: number
        exchanges: number
        refunds: number
      }>(sql`
        select
          (select count(*)::int from orders where user_id = ${userId}
            and status in ('pending_payment', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'rto_initiated')) as orders,
          (select count(*)::int from exchange_requests where user_id = ${userId}
            and status not in ('completed', 'rejected', 'cancelled', 'qc_failed')) as exchanges,
          (select count(*)::int from refunds r join orders o on o.id = r.order_id
            where o.user_id = ${userId} and r.status = 'pending') as refunds`)
      const { orders, exchanges, refunds } = open.rows[0]!
      if (orders > 0 || exchanges > 0 || refunds > 0) {
        throw new DomainError(
          "CONFLICT",
          "Finish this customer's open orders, exchanges and refunds first.",
        )
      }
      const balance = await spendableBalance(tx, userId)
      if (balance > 0) {
        throw new DomainError(
          "CONFLICT",
          "This customer still has wallet money. Settle it with them first.",
        )
      }

      const photos = await tx.execute<{ file_key: string }>(sql`
        delete from customer_photos where user_id = ${userId} returning file_key`)
      const labels = await tx.execute<{ label_file_key: string }>(sql`
        select s.label_file_key from shipments s join orders o on o.id = s.order_id
        where o.user_id = ${userId} and s.label_file_key is not null`)
      await tx.execute(sql`
        update shipments s set label_file_key = null, updated_at = now()
        from orders o where o.id = s.order_id and o.user_id = ${userId}`)
      await hideCustomerReviews(tx, userId, { erase: true })

      const placeholder = `deleted-${userId}@deleted.duis.invalid`
      await tx.execute(sql`
        update orders set customer_name = ${ERASED_NAME}, customer_email = null, customer_phone = null,
          shipping_address = shipping_address || ${JSON.stringify({
            fullName: ERASED_NAME,
            phone: "",
            line1: "Removed",
            line2: null,
            landmark: null,
          })}::jsonb,
          updated_at = now()
        where user_id = ${userId}`)
      await tx.execute(sql`
        update exchange_requests set customer_note = null, updated_at = now() where user_id = ${userId}`)
      await tx.execute(sql`
        update contact_messages set name = ${ERASED_NAME}, email = ${placeholder}, phone = null,
          message = '[removed at the customer''s request]'
        where user_id = ${userId} or email = ${user.email}`)
      await tx.execute(sql`delete from addresses where user_id = ${userId}`)
      await tx.execute(sql`delete from carts where user_id = ${userId}`)
      await tx.execute(
        sql`delete from wishlist_items where user_id = ${userId}`,
      )
      await tx.execute(sql`
        delete from stock_alerts where user_id = ${userId} or email = ${user.email}`)
      await tx.execute(sql`
        delete from newsletter_subscribers where email = ${user.email}`)
      await tx.execute(sql`delete from sessions where user_id = ${userId}`)
      await tx.execute(sql`delete from accounts where user_id = ${userId}`)
      await tx.execute(sql`delete from two_factors where user_id = ${userId}`)
      await tx.execute(sql`
        update customer_profiles set marketing_email_consent_at = null, marketing_whatsapp_consent_at = null,
          whatsapp_updates_consent_at = null, nominee_name = null, nominee_contact = null,
          erased_at = now(), updated_at = now()
        where user_id = ${userId}`)
      await tx.execute(sql`
        update users set name = ${ERASED_NAME}, email = ${placeholder}, email_verified = false,
          image = null, phone_number = null, phone_number_verified = false, two_factor_enabled = false,
          banned = true, ban_reason = 'Account deleted', updated_at = now()
        where id = ${userId}`)
      await recordConsents(tx, {
        userId,
        purposes: ["account"],
        granted: false,
        source: "account_deleted",
      })
      await writeAudit(tx, actor, {
        action: "customer.erase",
        entityType: "user",
        entityId: userId,
      })
      if (!user.email.endsWith(".invalid")) {
        await queueEmail(
          {
            template: "account-deleted",
            to: user.email,
            props: { name: user.name },
          },
          { tx },
        )
      }
      return [
        ...photos.rows.map((row) => row.file_key),
        ...labels.rows.map((row) => row.label_file_key),
      ].filter(Boolean)
    })
    // After the commit: a failed delete leaves an unlinked file, never a
    // record pointing at a missing one.
    for (const key of files) {
      await deletePrivateFile(key).catch((error: unknown) =>
        log.warn({ err: error, key }, "couldn't delete a customer's file"),
      )
    }
    log.info("customer erased")
    return {}
  },
})
