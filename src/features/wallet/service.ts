import "server-only"
import { sql } from "drizzle-orm"
import { z } from "zod"

import type { Actor } from "@/server/auth/actor"
import { writeAudit } from "@/server/audit"
import { getDb } from "@/server/db/client"
import { withTransaction, type Transaction } from "@/server/db/transaction"
import { DomainError } from "@/server/errors"
import { defineOperation } from "@/server/operation"

/**
 * Wallet ledger (doc/05 §7). The ledger is append-only and every entry has
 * an idempotency key, so a retried job can never pay or charge twice.
 * Credits become lots; debits spend the soonest-expiring lot first.
 * Promotional credit expires (doc/10 P12); refunded money never does.
 */

type Db = Transaction | ReturnType<typeof getDb>

export type WalletReason =
  | "order_payment"
  | "order_reversal"
  | "cancellation_refund"
  | "exchange_credit"
  | "goodwill"
  | "rto_advance_credit"
  | "expiry"
  | "adjustment"

type Reference = { type: string; id: string }

/** Spendable now: lots that still have money and have not expired. */
export async function spendableBalance(
  db: Db,
  userId: string,
): Promise<number> {
  const result = await db.execute<{ total: number }>(sql`
    select coalesce(sum(remaining_paise), 0)::int as total
    from wallet_credit_lots
    where user_id = ${userId} and remaining_paise > 0
      and (expires_at is null or expires_at > now())`)
  return result.rows[0]!.total
}

async function lockAccount(tx: Transaction, userId: string): Promise<void> {
  await tx.execute(sql`
    insert into wallet_accounts (user_id) values (${userId})
    on conflict (user_id) do nothing`)
  await tx.execute(
    sql`select 1 from wallet_accounts where user_id = ${userId} for update`,
  )
}

async function insertLedger(
  tx: Transaction,
  entry: {
    userId: string
    amountPaise: number
    reason: WalletReason
    reference?: Reference
    idempotencyKey: string
    expiresAt?: Date | null
    createdBy?: string | null
    note?: string
  },
): Promise<string | null> {
  const result = await tx.execute<{ id: string }>(sql`
    insert into wallet_ledger (user_id, amount_paise, reason, reference_type, reference_id,
                               idempotency_key, expires_at, created_by, note)
    values (${entry.userId}, ${entry.amountPaise}, ${entry.reason}, ${entry.reference?.type ?? null},
            ${entry.reference?.id ?? null}, ${entry.idempotencyKey}, ${entry.expiresAt ?? null},
            ${entry.createdBy ?? null}, ${entry.note ?? null})
    on conflict (idempotency_key) do nothing
    returning id`)
  return result.rows[0]?.id ?? null
}

async function moveBalance(tx: Transaction, userId: string, delta: number) {
  await tx.execute(sql`
    update wallet_accounts set balance_paise = balance_paise + ${delta}, updated_at = now()
    where user_id = ${userId}`)
}

/** Adds money. Returns false if this idempotency key was already used. */
export async function creditWallet(
  tx: Transaction,
  credit: {
    userId: string
    amountPaise: number
    reason: Exclude<WalletReason, "order_payment" | "expiry">
    reference?: Reference
    idempotencyKey: string
    /** Promotional credit only. */
    expiresAt?: Date | null
    createdBy?: string | null
    note?: string
  },
): Promise<boolean> {
  if (!Number.isInteger(credit.amountPaise) || credit.amountPaise <= 0) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "Credit must be a positive amount.",
    )
  }
  await lockAccount(tx, credit.userId)
  const ledgerId = await insertLedger(tx, credit)
  if (!ledgerId) return false
  await tx.execute(sql`
    insert into wallet_credit_lots (user_id, ledger_id, amount_paise, remaining_paise, expires_at)
    values (${credit.userId}, ${ledgerId}, ${credit.amountPaise}, ${credit.amountPaise}, ${credit.expiresAt ?? null})`)
  await moveBalance(tx, credit.userId, credit.amountPaise)
  return true
}

/**
 * Spends money, soonest-expiring credit first. Fails if the spendable
 * balance is short (it may have changed since the quote).
 */
export async function debitWallet(
  tx: Transaction,
  debit: {
    userId: string
    amountPaise: number
    reference: Reference
    idempotencyKey: string
  },
): Promise<boolean> {
  if (debit.amountPaise <= 0) return false
  await lockAccount(tx, debit.userId)
  const lots = await tx.execute<{ id: string; remaining_paise: number }>(sql`
    select id, remaining_paise from wallet_credit_lots
    where user_id = ${debit.userId} and remaining_paise > 0
      and (expires_at is null or expires_at > now())
    order by expires_at nulls last, created_at
    for update`)
  const available = lots.rows.reduce((sum, lot) => sum + lot.remaining_paise, 0)
  if (available < debit.amountPaise) {
    throw new DomainError(
      "CONFLICT",
      "Your wallet balance has changed. Please review your order.",
    )
  }
  const ledgerId = await insertLedger(tx, {
    userId: debit.userId,
    amountPaise: -debit.amountPaise,
    reason: "order_payment",
    reference: debit.reference,
    idempotencyKey: debit.idempotencyKey,
  })
  if (!ledgerId) return false
  let left = debit.amountPaise
  for (const lot of lots.rows) {
    if (left === 0) break
    const take = Math.min(left, lot.remaining_paise)
    left -= take
    await tx.execute(sql`
      update wallet_credit_lots set remaining_paise = remaining_paise - ${take} where id = ${lot.id}`)
    await tx.execute(sql`
      insert into wallet_lot_usages (debit_ledger_id, lot_id, amount_paise)
      values (${ledgerId}, ${lot.id}, ${take})`)
  }
  await moveBalance(tx, debit.userId, -debit.amountPaise)
  return true
}

/**
 * Undoes a debit (order expired or cancelled). Each debit has exactly one
 * reversal (key `<debit key>:reversal`), so reversing twice, for any reason,
 * credits once. The money returns to the lots it came from, so promotional
 * credit keeps its original expiry.
 */
export async function reverseDebit(
  tx: Transaction,
  input: {
    debitIdempotencyKey: string
    reason: "order_reversal" | "cancellation_refund"
  },
): Promise<number> {
  const debit = await tx.execute<{
    id: string
    user_id: string
    amount_paise: number
    reference_type: string | null
    reference_id: string | null
  }>(sql`
    select id, user_id, amount_paise, reference_type, reference_id from wallet_ledger
    where idempotency_key = ${input.debitIdempotencyKey} and amount_paise < 0`)
  const row = debit.rows[0]
  if (!row) return 0
  await lockAccount(tx, row.user_id)
  const amount = -row.amount_paise
  const ledgerId = await insertLedger(tx, {
    userId: row.user_id,
    amountPaise: amount,
    reason: input.reason,
    reference:
      row.reference_type && row.reference_id
        ? { type: row.reference_type, id: row.reference_id }
        : undefined,
    idempotencyKey: `${input.debitIdempotencyKey}:reversal`,
  })
  if (!ledgerId) return 0
  await tx.execute(sql`
    update wallet_credit_lots l set remaining_paise = l.remaining_paise + u.amount_paise
    from wallet_lot_usages u
    where u.debit_ledger_id = ${row.id} and u.lot_id = l.id`)
  await moveBalance(tx, row.user_id, amount)
  return amount
}

/** wallet.expire-credits job: removes what is left of expired promotional lots. */
export async function expireWalletCredits(batchSize = 500): Promise<number> {
  return withTransaction(async (tx) => {
    const due = await tx.execute<{
      id: string
      user_id: string
      remaining_paise: number
    }>(sql`
      select id, user_id, remaining_paise from wallet_credit_lots
      where remaining_paise > 0 and expires_at <= now()
      order by expires_at
      limit ${batchSize}
      for update skip locked`)
    for (const lot of due.rows) {
      await lockAccount(tx, lot.user_id)
      await insertLedger(tx, {
        userId: lot.user_id,
        amountPaise: -lot.remaining_paise,
        reason: "expiry",
        reference: { type: "wallet_credit_lot", id: lot.id },
        idempotencyKey: `expiry:${lot.id}:${crypto.randomUUID()}`,
      })
      await tx.execute(
        sql`update wallet_credit_lots set remaining_paise = 0 where id = ${lot.id}`,
      )
      await moveBalance(tx, lot.user_id, -lot.remaining_paise)
    }
    return due.rows.length
  })
}

// --- Operations ----------------------------------------------------------------------

export type WalletSummary = {
  balancePaise: number
  expiring: { amountPaise: number; expiresAt: Date }[]
  entries: {
    id: string
    amountPaise: number
    reason: WalletReason
    note: string | null
    expiresAt: Date | null
    createdAt: Date
  }[]
}

export const getWalletSummary = defineOperation({
  name: "wallet.getSummary",
  access: "authenticated",
  input: z.object({}),
  async handler({ actor }): Promise<WalletSummary> {
    if (actor.kind !== "user")
      throw new DomainError("UNAUTHENTICATED", "Please sign in to continue.")
    const db = getDb()
    const [balancePaise, expiring, entries] = await Promise.all([
      spendableBalance(db, actor.userId),
      db.execute<{ amount: number; expires_at: Date }>(sql`
        select remaining_paise as amount, expires_at from wallet_credit_lots
        where user_id = ${actor.userId} and remaining_paise > 0 and expires_at > now()
        order by expires_at`),
      db.execute<{
        id: string
        amount_paise: number
        reason: WalletReason
        note: string | null
        expires_at: Date | null
        created_at: Date
      }>(sql`
        select id, amount_paise, reason, note, expires_at, created_at from wallet_ledger
        where user_id = ${actor.userId} order by created_at desc limit 50`),
    ])
    return {
      balancePaise,
      expiring: expiring.rows.map((r) => ({
        amountPaise: r.amount,
        expiresAt: new Date(r.expires_at),
      })),
      entries: entries.rows.map((r) => ({
        id: r.id,
        amountPaise: r.amount_paise,
        reason: r.reason,
        note: r.note,
        expiresAt: r.expires_at ? new Date(r.expires_at) : null,
        createdAt: new Date(r.created_at),
      })),
    }
  },
})

/** Staff goodwill credit: promotional, so it expires (doc/10 P12). */
export const grantGoodwillCredit = defineOperation({
  name: "wallet.grantGoodwill",
  access: { customer: ["credit"] },
  input: z.object({
    userId: z.uuid(),
    amountPaise: z.number().int().min(100).max(10_000_00),
    note: z.string().trim().min(3).max(300),
    idempotencyKey: z.string().min(8).max(100),
  }),
  async handler({ actor }, input) {
    return withTransaction(async (tx) => {
      const settings = await tx.execute<{ days: number }>(
        sql`select promo_credit_validity_days as days from store_settings where id = 1`,
      )
      const days = settings.rows[0]?.days ?? 30
      const granted = await creditWallet(tx, {
        userId: input.userId,
        amountPaise: input.amountPaise,
        reason: "goodwill",
        idempotencyKey: `goodwill:${input.idempotencyKey}`,
        expiresAt: new Date(Date.now() + days * 86_400_000),
        createdBy: actor.kind === "user" ? actor.userId : null,
        note: input.note,
      })
      if (granted) {
        await writeAudit(tx, actor as Actor, {
          action: "wallet.grant_goodwill",
          entityType: "user",
          entityId: input.userId,
          changes: { amountPaise: input.amountPaise, note: input.note },
        })
      }
      return { granted }
    })
  },
})
