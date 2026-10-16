import "server-only"
import { sql } from "drizzle-orm"
import { z } from "zod"

import { rolesAllow } from "@/server/auth/permissions"
import { getDb } from "@/server/db/client"
import { defineOperation } from "@/server/operation"

/**
 * Dashboard figures (doc/06 Phase 4 §2). Revenue counts orders that were
 * confirmed (paid or partly paid), net of cancellations, in IST days.
 */

const PLACED = sql`o.status not in ('pending_payment', 'expired', 'cancelled')`

export type SalesSummary = {
  revenuePaise: number
  orders: number
  averageOrderPaise: number
  codDuePaise: number
  daily: { day: string; revenuePaise: number; orders: number }[]
  bestSellers: {
    productId: string
    title: string
    units: number
    revenuePaise: number
  }[]
}

export const salesSummary = defineOperation({
  name: "reports.salesSummary",
  access: { order: ["read_financials"] },
  input: z.object({ days: z.number().int().min(1).max(366).default(30) }),
  async handler(_ctx, { days }): Promise<SalesSummary> {
    const db = getDb()
    const [totals, daily, best] = await Promise.all([
      db.execute<{ revenue: number; orders: number; cod_due: number }>(sql`
        select coalesce(sum(o.total_paise), 0)::bigint::float8 as revenue, count(*)::int as orders,
               coalesce(sum(o.cod_due_paise) filter (where o.cod_collected_at is null), 0)::bigint::float8 as cod_due
        from orders o where ${PLACED} and o.confirmed_at >= now() - make_interval(days => ${days})`),
      db.execute<{ day: string; revenue: number; orders: number }>(sql`
        select to_char(d.day, 'YYYY-MM-DD') as day,
               coalesce(sum(o.total_paise), 0)::bigint::float8 as revenue, count(o.id)::int as orders
        from generate_series((now() at time zone 'Asia/Kolkata')::date - (${days} - 1), (now() at time zone 'Asia/Kolkata')::date, interval '1 day') d(day)
        left join orders o on ${PLACED} and (o.confirmed_at at time zone 'Asia/Kolkata')::date = d.day
        group by d.day order by d.day`),
      db.execute<{
        product_id: string
        title: string
        units: number
        revenue: number
      }>(sql`
        select i.product_id, max(i.title) as title, sum(i.quantity)::int as units,
               sum(i.line_total_paise)::bigint::float8 as revenue
        from order_items i join orders o on o.id = i.order_id
        where ${PLACED} and o.confirmed_at >= now() - make_interval(days => ${days}) and i.product_id is not null
        group by i.product_id order by units desc, revenue desc limit 8`),
    ])
    const t = totals.rows[0]!
    return {
      revenuePaise: t.revenue,
      orders: t.orders,
      averageOrderPaise: t.orders ? Math.round(t.revenue / t.orders) : 0,
      codDuePaise: t.cod_due,
      daily: daily.rows.map((r) => ({
        day: r.day,
        revenuePaise: r.revenue,
        orders: r.orders,
      })),
      bestSellers: best.rows.map((r) => ({
        productId: r.product_id,
        title: r.title,
        units: r.units,
        revenuePaise: r.revenue,
      })),
    }
  },
})

export type OperationsSummary = {
  toFulfil: number
  awaitingPayment: number
  recent: {
    orderNumber: string
    customer: string
    status: string
    placedAt: Date
    totalPaise: number | null
  }[]
}

export const operationsSummary = defineOperation({
  name: "reports.operationsSummary",
  access: { order: ["read"] },
  input: z.object({}),
  async handler({ actor }): Promise<OperationsSummary> {
    // Fulfilment staff see the queue but not order values.
    const financials =
      actor.kind === "system" ||
      (actor.kind === "user" &&
        rolesAllow(actor.roles, { order: ["read_financials"] }))
    const db = getDb()
    const [counts, recent] = await Promise.all([
      db.execute<{ to_fulfil: number; awaiting: number }>(sql`
        select count(*) filter (where status in ('confirmed', 'processing') and fulfillment_status = 'unfulfilled')::int as to_fulfil,
               count(*) filter (where status = 'pending_payment')::int as awaiting
        from orders`),
      db.execute<{
        order_number: string
        customer_name: string
        status: string
        placed_at: Date
        total_paise: number
      }>(sql`
        select order_number, customer_name, status, placed_at, total_paise from orders
        where status <> 'expired' order by placed_at desc limit 8`),
    ])
    return {
      toFulfil: counts.rows[0]!.to_fulfil,
      awaitingPayment: counts.rows[0]!.awaiting,
      recent: recent.rows.map((r) => ({
        orderNumber: r.order_number,
        customer: r.customer_name,
        status: r.status,
        placedAt: new Date(r.placed_at),
        totalPaise: financials ? r.total_paise : null,
      })),
    }
  },
})
