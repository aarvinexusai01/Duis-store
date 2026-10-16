import "server-only"
import { sql } from "drizzle-orm"
import { z } from "zod"

import { getServerEnv } from "@/config/env"
import type { Actor } from "@/server/auth/actor"
import { writeAudit } from "@/server/audit"
import { requestRevalidation } from "@/server/cache/revalidate"
import { cacheTags } from "@/server/cache/tags"
import { getDb } from "@/server/db/client"
import { withTransaction, type Transaction } from "@/server/db/transaction"
import { DomainError, isUniqueViolation } from "@/server/errors"
import { queueEmail } from "@/server/notifications/email"
import { defineOperation } from "@/server/operation"

/**
 * Verified-buyer reviews (doc/06 Phase 5 §5): one per delivered order line,
 * every one moderated first (doc/10 P14). Approved reviews update the
 * product's rating and refresh its pages.
 */

const userOf = (actor: Actor) => {
  if (actor.kind !== "user")
    throw new DomainError("UNAUTHENTICATED", "Please sign in to continue.")
  return actor
}

/** "Asha Rao" → "Asha R." (never a full name or email on the product page). */
export function displayNameFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0 || name.includes("@")) return "Verified buyer"
  const first = parts[0]!.slice(0, 30)
  return parts.length > 1
    ? `${first} ${parts.at(-1)![0]!.toUpperCase()}.`
    : first
}

export const submitReview = defineOperation({
  name: "reviews.submit",
  access: "authenticated",
  input: z.object({
    orderItemId: z.uuid(),
    rating: z.number().int().min(1).max(5),
    title: z.string().trim().max(100).optional(),
    body: z
      .string()
      .trim()
      .min(10, "Tell us a little more (10 characters or more).")
      .max(2000),
    fit: z.enum(["runs_small", "true_to_size", "runs_large"]).optional(),
    photoIds: z.array(z.uuid()).max(3).default([]),
  }),
  async handler({ actor }, input) {
    const user = userOf(actor)
    try {
      return await withTransaction(async (tx) => {
        const item = await tx.execute<{
          product_id: string | null
          delivered: boolean
          name: string
        }>(sql`
          select oi.product_id, u.name,
            exists (select 1 from shipments s where s.order_id = o.id and s.status = 'delivered') as delivered
          from order_items oi join orders o on o.id = oi.order_id join users u on u.id = o.user_id
          where oi.id = ${input.orderItemId} and o.user_id = ${user.userId}`)
        const row = item.rows[0]
        if (!row?.product_id)
          throw new DomainError("NOT_FOUND", "Item not found.")
        if (!row.delivered) {
          throw new DomainError(
            "INVALID_STATE",
            "You can review this once it's delivered.",
          )
        }
        if (input.photoIds.length > 0) {
          const mine = await tx.execute<{ n: number }>(sql`
            select count(*)::int as n from customer_photos where user_id = ${user.userId}
              and id in (${sql.join(
                input.photoIds.map((id) => sql`${id}`),
                sql`, `,
              )})`)
          if (mine.rows[0]!.n !== input.photoIds.length)
            throw new DomainError("FORBIDDEN", "Unknown photo.")
        }
        const created = await tx.execute<{ id: string }>(sql`
          insert into reviews (product_id, user_id, order_item_id, rating, title, body, fit, display_name)
          values (${row.product_id}, ${user.userId}, ${input.orderItemId}, ${input.rating},
                  ${input.title || null}, ${input.body}, ${input.fit ?? null}, ${displayNameFor(row.name)})
          returning id`)
        const id = created.rows[0]!.id
        for (const photoId of input.photoIds) {
          await tx.execute(sql`
            insert into review_photos (review_id, photo_id) values (${id}, ${photoId})`)
        }
        return { id }
      })
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainError("CONFLICT", "You've already reviewed this item.")
      }
      throw error
    }
  },
})

/** Which delivered items in the customer's order still have no review. */
export const listReviewableItems = defineOperation({
  name: "reviews.reviewable",
  access: "authenticated",
  input: z.object({ orderNumber: z.string().regex(/^DUIS-\d{6,}$/) }),
  async handler({ actor }, input) {
    const user = userOf(actor)
    const rows = await getDb().execute<{
      id: string
      title: string
      variant_label: string
      image_key: string | null
      reviewed: string | null
    }>(sql`
      select oi.id, oi.title, oi.variant_label, oi.image_key,
             (select r.status::text from reviews r where r.order_item_id = oi.id) as reviewed
      from order_items oi join orders o on o.id = oi.order_id
      where o.order_number = ${input.orderNumber} and o.user_id = ${user.userId} and oi.product_id is not null
        and exists (select 1 from shipments s where s.order_id = o.id and s.status = 'delivered')
      order by oi.position`)
    return rows.rows.map((r) => ({
      orderItemId: r.id,
      title: r.title,
      variantLabel: r.variant_label,
      imageKey: r.image_key,
      reviewStatus: r.reviewed as "pending" | "approved" | "rejected" | null,
    }))
  },
})

export type ProductReviews = {
  count: number
  average: number
  distribution: Record<1 | 2 | 3 | 4 | 5, number>
  fit: { runs_small: number; true_to_size: number; runs_large: number }
  reviews: {
    id: string
    rating: number
    title: string | null
    body: string
    fit: string | null
    displayName: string
    createdAt: Date
    photoIds: string[]
  }[]
}

/** Approved reviews and their summary (uncached; see queries.ts). */
export async function loadProductReviews(
  productId: string,
  limit = 10,
): Promise<ProductReviews> {
  const db = getDb()
  const [stats, rows] = await Promise.all([
    db.execute<{
      count: number
      average: number | null
      d1: number
      d2: number
      d3: number
      d4: number
      d5: number
      small: number
      true_size: number
      large: number
    }>(sql`
      select count(*)::int as count, avg(rating)::float as average,
        count(*) filter (where rating = 1)::int as d1, count(*) filter (where rating = 2)::int as d2,
        count(*) filter (where rating = 3)::int as d3, count(*) filter (where rating = 4)::int as d4,
        count(*) filter (where rating = 5)::int as d5,
        count(*) filter (where fit = 'runs_small')::int as small,
        count(*) filter (where fit = 'true_to_size')::int as true_size,
        count(*) filter (where fit = 'runs_large')::int as large
      from reviews where product_id = ${productId} and status = 'approved'`),
    db.execute<{
      id: string
      rating: number
      title: string | null
      body: string
      fit: string | null
      display_name: string
      created_at: Date
      photo_ids: string[] | null
    }>(sql`
      select r.id, r.rating, r.title, r.body, r.fit, r.display_name, r.created_at,
             (select array_agg(rp.photo_id) from review_photos rp where rp.review_id = r.id) as photo_ids
      from reviews r where r.product_id = ${productId} and r.status = 'approved'
      order by r.created_at desc limit ${limit}`),
  ])
  const s = stats.rows[0]!
  return {
    count: s.count,
    average: s.average ? Math.round(s.average * 10) / 10 : 0,
    distribution: { 1: s.d1, 2: s.d2, 3: s.d3, 4: s.d4, 5: s.d5 },
    fit: {
      runs_small: s.small,
      true_to_size: s.true_size,
      runs_large: s.large,
    },
    reviews: rows.rows.map((r) => ({
      id: r.id,
      rating: r.rating,
      title: r.title,
      body: r.body,
      fit: r.fit,
      displayName: r.display_name,
      createdAt: new Date(r.created_at),
      photoIds: r.photo_ids ?? [],
    })),
  }
}

/** Keeps products.rating_* in step with approved reviews. */
async function refreshProductRating(tx: Transaction, productId: string) {
  await tx.execute(sql`
    update products p set
      rating_count = s.count,
      rating_average = coalesce(round(s.average * 100), 0)::int
    from (select count(*)::int as count, avg(rating) as average
          from reviews where product_id = ${productId} and status = 'approved') s
    where p.id = ${productId}`)
}

export const REVIEWS_PAGE_SIZE = 50

export const adminListReviews = defineOperation({
  name: "reviews.adminList",
  access: { review: ["read"] },
  input: z.object({
    status: z.enum(["pending", "approved", "rejected"]).default("pending"),
    page: z.number().int().min(1).max(10_000).default(1),
  }),
  async handler(_ctx, input) {
    const rows = await getDb().execute<{
      id: string
      product_id: string
      product_title: string
      rating: number
      title: string | null
      body: string
      fit: string | null
      display_name: string
      customer_email: string
      created_at: Date
      moderation_note: string | null
      photo_ids: string[] | null
      total: number
    }>(sql`
      select r.id, r.product_id, p.title as product_title, r.rating, r.title, r.body, r.fit,
             r.display_name, u.email as customer_email, r.created_at, r.moderation_note,
             (select array_agg(rp.photo_id) from review_photos rp where rp.review_id = r.id) as photo_ids,
             count(*) over ()::int as total
      from reviews r join products p on p.id = r.product_id join users u on u.id = r.user_id
      where r.status = ${input.status}
      order by r.created_at ${input.status === "pending" ? sql`asc` : sql`desc`}
      limit ${REVIEWS_PAGE_SIZE} offset ${(input.page - 1) * REVIEWS_PAGE_SIZE}`)
    return {
      total: rows.rows[0]?.total ?? 0,
      rows: rows.rows.map((r) => ({
        id: r.id,
        productId: r.product_id,
        productTitle: r.product_title,
        rating: r.rating,
        title: r.title,
        body: r.body,
        fit: r.fit,
        displayName: r.display_name,
        customerEmail: r.customer_email.endsWith(".invalid")
          ? null
          : r.customer_email,
        createdAt: new Date(r.created_at),
        moderationNote: r.moderation_note,
        photoIds: r.photo_ids ?? [],
      })),
    }
  },
})

export const moderateReview = defineOperation({
  name: "reviews.moderate",
  access: { review: ["moderate"] },
  input: z.object({
    reviewId: z.uuid(),
    decision: z.enum(["approved", "rejected"]),
    note: z.string().trim().max(300).optional(),
  }),
  async handler({ actor }, input) {
    return withTransaction(async (tx) => {
      const updated = await tx.execute<{ product_id: string; was: string }>(sql`
        update reviews r set status = ${input.decision}::review_status, moderation_note = ${input.note ?? null},
          moderated_at = now(), moderated_by = ${actor.kind === "user" ? actor.userId : null}, updated_at = now()
        from (select id, status::text as was from reviews where id = ${input.reviewId} for update) old
        where r.id = old.id
        returning r.product_id, old.was`)
      const row = updated.rows[0]
      if (!row) throw new DomainError("NOT_FOUND", "Review not found.")
      if (row.was === "approved" || input.decision === "approved") {
        await refreshProductRating(tx, row.product_id)
        await requestRevalidation(
          [cacheTags.product(row.product_id), cacheTags.productsList],
          { tx },
        )
      }
      await writeAudit(tx, actor, {
        action: `review.${input.decision === "approved" ? "approve" : "reject"}`,
        entityType: "review",
        entityId: input.reviewId,
        changes: { note: input.note },
      })
      return {}
    })
  },
})

/**
 * reviews.request job: asks for a review five days after delivery, once per
 * order, while there is something left to review.
 */
export async function sendReviewRequests(batchSize = 200): Promise<number> {
  const due = await getDb().execute<{
    id: string
    order_number: string
    user_id: string
    customer_name: string
    customer_email: string | null
  }>(sql`
    select o.id, o.order_number, o.user_id, o.customer_name, o.customer_email from orders o
    where o.status = 'delivered' and o.review_requested_at is null
      and exists (select 1 from shipments s where s.order_id = o.id and s.direction = 'forward'
                  and s.delivered_at between now() - interval '30 days' and now() - interval '5 days')
      and exists (select 1 from order_items oi where oi.order_id = o.id and oi.product_id is not null
                  and not exists (select 1 from reviews r where r.order_item_id = oi.id))
    order by o.placed_at limit ${batchSize}`)
  let sent = 0
  for (const order of due.rows) {
    await withTransaction(async (tx) => {
      const claimed = await tx.execute<{ id: string }>(sql`
        update orders set review_requested_at = now() where id = ${order.id} and review_requested_at is null
        returning id`)
      if (!claimed.rows[0]) return
      if (!order.customer_email || order.customer_email.endsWith(".invalid"))
        return
      await queueEmail(
        {
          template: "review-request",
          to: order.customer_email,
          userId: order.user_id,
          reference: { type: "order", id: order.id },
          props: {
            name: order.customer_name,
            orderNumber: order.order_number,
            url: new URL(
              `/account/orders/${order.order_number}#reviews`,
              getServerEnv().APP_URL,
            ).toString(),
          },
        },
        { tx },
      )
      sent += 1
    })
  }
  return sent
}
