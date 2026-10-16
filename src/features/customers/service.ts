import "server-only"
import { and, asc, count, desc, eq, sql } from "drizzle-orm"
import { z } from "zod"

import { accounts, addresses, customerProfiles, users } from "@/db/schema"
import type { Actor } from "@/server/auth/actor"
import { getDb } from "@/server/db/client"
import { withTransaction } from "@/server/db/transaction"
import { DomainError } from "@/server/errors"
import { defineOperation } from "@/server/operation"

import { addressInputSchema, consentSchema, profileSchema } from "./schemas"

/** Customer self-service (doc/06 Phase 2 §9). Every query is scoped to the caller. */

const MAX_ADDRESSES = 20
// Phone sign-ups get a placeholder address on a reserved TLD (auth/options.ts).
const PLACEHOLDER_EMAIL = /@phone\.duis\.invalid$/

function ownerId(actor: Actor): string {
  if (actor.kind !== "user") {
    throw new DomainError("UNAUTHENTICATED", "Please sign in to continue.")
  }
  return actor.userId
}

export type AccountOverview = {
  name: string
  email: string | null
  emailVerified: boolean
  phoneNumber: string | null
  hasPassword: boolean
  marketingEmail: boolean
  marketingWhatsapp: boolean
  /** Order and exchange updates on WhatsApp (not marketing). */
  whatsappUpdates: boolean
  deletionRequestedAt: Date | null
}

export const getAccountOverview = defineOperation({
  name: "customers.getOverview",
  access: "authenticated",
  input: z.object({}),
  async handler({ actor }): Promise<AccountOverview> {
    const userId = ownerId(actor)
    const db = getDb()
    const [user] = await db
      .select({
        name: users.name,
        email: users.email,
        emailVerified: users.emailVerified,
        phoneNumber: users.phoneNumber,
      })
      .from(users)
      .where(eq(users.id, userId))
    if (!user) throw new DomainError("NOT_FOUND", "Account not found.")
    const [[password], [profile]] = await Promise.all([
      db
        .select({ n: count() })
        .from(accounts)
        .where(
          and(
            eq(accounts.userId, userId),
            eq(accounts.providerId, "credential"),
          ),
        ),
      db
        .select()
        .from(customerProfiles)
        .where(eq(customerProfiles.userId, userId)),
    ])
    const realEmail = !PLACEHOLDER_EMAIL.test(user.email)
    return {
      name: user.name,
      email: realEmail ? user.email : null,
      emailVerified: realEmail && user.emailVerified,
      phoneNumber: user.phoneNumber ?? null,
      hasPassword: (password?.n ?? 0) > 0,
      marketingEmail: Boolean(profile?.marketingEmailConsentAt),
      marketingWhatsapp: Boolean(profile?.marketingWhatsappConsentAt),
      whatsappUpdates: Boolean(profile?.whatsappUpdatesConsentAt),
      deletionRequestedAt: profile?.deletionRequestedAt ?? null,
    }
  },
})

export const updateProfile = defineOperation({
  name: "customers.updateProfile",
  access: "authenticated",
  input: profileSchema,
  async handler({ actor }, { name }) {
    await getDb()
      .update(users)
      .set({ name, updatedAt: new Date() })
      .where(eq(users.id, ownerId(actor)))
  },
})

/**
 * Marketing consent is separate per channel and withdrawable (DPDP Act).
 * Turning one on keeps its original timestamp; turning it off clears it.
 */
export const setMarketingConsent = defineOperation({
  name: "customers.setMarketingConsent",
  access: "authenticated",
  input: consentSchema,
  async handler({ actor, log }, { marketingEmail, marketingWhatsapp }) {
    const userId = ownerId(actor)
    await getDb().execute(sql`
      insert into customer_profiles (user_id, marketing_email_consent_at, marketing_whatsapp_consent_at)
      values (${userId}, case when ${marketingEmail} then now() end, case when ${marketingWhatsapp} then now() end)
      on conflict (user_id) do update set
        marketing_email_consent_at = case when ${marketingEmail}
          then coalesce(customer_profiles.marketing_email_consent_at, now()) end,
        marketing_whatsapp_consent_at = case when ${marketingWhatsapp}
          then coalesce(customer_profiles.marketing_whatsapp_consent_at, now()) end,
        updated_at = now()`)
    log.info({ marketingEmail, marketingWhatsapp }, "marketing consent updated")
  },
})

/** Records a deletion request; support completes it (doc/08, DPDP). */
export const setDeletionRequest = defineOperation({
  name: "customers.setDeletionRequest",
  access: "authenticated",
  input: z.object({ requested: z.boolean() }),
  async handler({ actor, log }, { requested }) {
    const userId = ownerId(actor)
    await getDb().execute(sql`
      insert into customer_profiles (user_id, deletion_requested_at)
      values (${userId}, ${requested ? sql`now()` : sql`null`})
      on conflict (user_id) do update set
        deletion_requested_at = ${requested ? sql`coalesce(customer_profiles.deletion_requested_at, now())` : sql`null`},
        updated_at = now()`)
    log.info({ requested }, "account deletion request updated")
  },
})

// --- Addresses ---------------------------------------------------------------------

export type Address = typeof addresses.$inferSelect

export const listAddresses = defineOperation({
  name: "customers.listAddresses",
  access: "authenticated",
  input: z.object({}),
  async handler({ actor }): Promise<Address[]> {
    return getDb()
      .select()
      .from(addresses)
      .where(eq(addresses.userId, ownerId(actor)))
      .orderBy(desc(addresses.isDefault), asc(addresses.createdAt))
  },
})

export const saveAddress = defineOperation({
  name: "customers.saveAddress",
  access: "authenticated",
  input: addressInputSchema,
  async handler({ actor }, { id, isDefault, ...fields }) {
    const userId = ownerId(actor)
    return withTransaction(async (tx) => {
      const existing = await tx
        .select({ id: addresses.id, isDefault: addresses.isDefault })
        .from(addresses)
        .where(eq(addresses.userId, userId))
        .for("update")
      if (id && !existing.some((address) => address.id === id)) {
        throw new DomainError("NOT_FOUND", "Address not found.")
      }
      if (!id && existing.length >= MAX_ADDRESSES) {
        throw new DomainError(
          "CONFLICT",
          `You can save up to ${MAX_ADDRESSES} addresses.`,
        )
      }
      // The first address is the default; asking for default moves the flag.
      const makeDefault =
        isDefault ||
        existing.length === 0 ||
        (id !== undefined && existing.length === 1)
      if (makeDefault) {
        await tx
          .update(addresses)
          .set({ isDefault: false })
          .where(
            and(eq(addresses.userId, userId), eq(addresses.isDefault, true)),
          )
      }
      const values = {
        ...fields,
        line2: fields.line2 ?? null,
        landmark: fields.landmark ?? null,
        region: fields.region ?? null,
        stateCode: fields.stateCode ?? null,
      }
      if (id) {
        await tx
          .update(addresses)
          .set({ ...values, ...(makeDefault ? { isDefault: true } : {}) })
          .where(and(eq(addresses.id, id), eq(addresses.userId, userId)))
        return { id }
      }
      const [created] = await tx
        .insert(addresses)
        .values({ ...values, userId, isDefault: makeDefault })
        .returning({ id: addresses.id })
      return { id: created!.id }
    })
  },
})

export const deleteAddress = defineOperation({
  name: "customers.deleteAddress",
  access: "authenticated",
  input: z.object({ id: z.uuid() }),
  async handler({ actor }, { id }) {
    const userId = ownerId(actor)
    await withTransaction(async (tx) => {
      const [removed] = await tx
        .delete(addresses)
        .where(and(eq(addresses.id, id), eq(addresses.userId, userId)))
        .returning({ isDefault: addresses.isDefault })
      if (!removed) throw new DomainError("NOT_FOUND", "Address not found.")
      if (removed.isDefault) {
        // Promote the oldest remaining address, if any.
        await tx.execute(sql`
          update addresses set is_default = true
          where id = (select id from addresses where user_id = ${userId} order by created_at limit 1)`)
      }
    })
  },
})

/**
 * Order and exchange updates on WhatsApp (owner decision 2026-10-16): an
 * unticked box at checkout and a switch in the account; STOP also ends it.
 */
export const setWhatsAppUpdates = defineOperation({
  name: "customers.setWhatsAppUpdates",
  access: "authenticated",
  input: z.object({ enabled: z.boolean() }),
  async handler({ actor, log }, { enabled }) {
    const userId = ownerId(actor)
    await getDb().execute(sql`
      insert into customer_profiles (user_id, whatsapp_updates_consent_at)
      values (${userId}, case when ${enabled} then now() end)
      on conflict (user_id) do update set
        whatsapp_updates_consent_at = case when ${enabled}
          then coalesce(customer_profiles.whatsapp_updates_consent_at, now()) end,
        updated_at = now()`)
    log.info({ enabled }, "WhatsApp updates preference saved")
  },
})
