import "server-only"
import { sql } from "drizzle-orm"

import type { UserActor } from "@/server/auth/actor"
import { rolesAllow, type PermissionRequest } from "@/server/auth/permissions"
import { getDb } from "@/server/db/client"

import type { TodoItem } from "./service"

/** Stock at the default location, as the inventory page counts it. */
const AVAILABLE = sql`coalesce(l.on_hand - l.reserved, 0)`
const SELLABLE_VARIANTS = sql`
  from product_variants v
  join products p on p.id = v.product_id and p.status = 'active'
  left join inventory_levels l on l.variant_id = v.id
    and l.location_id = (select id from stock_locations where is_default)
  where v.status = 'active'`

/**
 * What needs someone today (the helper's to-do list and the dashboard card).
 * Each line is counted only for people whose role can act on it.
 */
const TODOS: {
  key: string
  one: string
  many: string
  href: string
  permission: PermissionRequest
  countSql: ReturnType<typeof sql>
}[] = [
  {
    key: "ship",
    one: "order to ship",
    many: "orders to ship",
    href: "/admin/orders?view=to_ship",
    permission: { order: ["read"] },
    countSql: sql`(select count(*) from orders o
      where o.status in ('confirmed', 'processing')
        and not exists (select 1 from shipments s where s.order_id = o.id
          and s.status not in ('cancelled', 'pending')))`,
  },
  {
    key: "exchanges",
    one: "exchange request to decide",
    many: "exchange requests to decide",
    href: "/admin/exchanges?status=requested",
    permission: { exchange: ["decide"] },
    countSql: sql`(select count(*) from exchange_requests where status = 'requested')`,
  },
  {
    key: "messages",
    one: "new customer message",
    many: "new customer messages",
    href: "/admin/messages",
    permission: { customer: ["read"] },
    countSql: sql`(select count(*) from contact_messages
      where status = 'new' and topic <> 'privacy')`,
  },
  {
    key: "privacy",
    one: "privacy request to answer",
    many: "privacy requests to answer",
    href: "/admin/data-requests",
    permission: { customer: ["read"] },
    countSql: sql`((select count(*) from customer_profiles
        where deletion_requested_at is not null and erased_at is null)
      + (select count(*) from contact_messages
        where topic = 'privacy' and status <> 'closed'))`,
  },
  {
    key: "reviews",
    one: "review to approve",
    many: "reviews to approve",
    href: "/admin/reviews",
    permission: { review: ["moderate"] },
    countSql: sql`(select count(*) from reviews where status = 'pending')`,
  },
  {
    key: "soldout",
    one: "size sold out",
    many: "sizes sold out",
    href: "/admin/inventory?low=1",
    permission: { inventory: ["read"] },
    countSql: sql`(select count(*) ${SELLABLE_VARIANTS} and ${AVAILABLE} <= 0)`,
  },
  {
    key: "lowstock",
    one: "size running low",
    many: "sizes running low",
    href: "/admin/inventory?low=1",
    permission: { inventory: ["read"] },
    countSql: sql`(select count(*) ${SELLABLE_VARIANTS} and ${AVAILABLE} > 0
      and ${AVAILABLE} <= coalesce(l.low_stock_threshold, 5))`,
  },
  {
    key: "drafts",
    one: "draft product to finish",
    many: "draft products to finish",
    href: "/admin/products?status=draft",
    permission: { catalog: ["update"] },
    countSql: sql`(select count(*) from products where status = 'draft')`,
  },
  {
    key: "photos",
    one: "product with a colour missing photos",
    many: "products with a colour missing photos",
    href: "/admin/products",
    permission: { catalog: ["update"] },
    // Only products sold in two or more colours: with one colour, untagged
    // photos are that colour's photos.
    countSql: sql`(select count(*) from (
      select pc.product_id
      from (
        select distinct v.product_id, vav.attribute_value_id as colour
        from product_variants v
        join products p on p.id = v.product_id and p.status <> 'archived'
        join variant_attribute_values vav on vav.variant_id = v.id
        where v.status = 'active'
          and vav.attribute_id = (select id from attributes where code = 'color')
      ) pc
      group by pc.product_id
      having count(*) >= 2
        and bool_or(not exists (select 1 from product_media pm
          where pm.product_id = pc.product_id and pm.color_value_id = pc.colour))
    ) missing)`,
  },
  {
    key: "collections",
    one: "empty collection in the shop",
    many: "empty collections in the shop",
    href: "/admin/collections",
    permission: { collection: ["update"] },
    countSql: sql`(select count(*) from collections c
      where c.status = 'published' and not exists (
        select 1 from collection_products cp join products p on p.id = cp.product_id
        where cp.collection_id = c.id and p.status = 'active'))`,
  },
  {
    key: "pages",
    one: "page waiting for review",
    many: "pages waiting for review",
    href: "/admin/cms",
    permission: { cms: ["publish"] },
    countSql: sql`(select count(*) from cms_revisions where workflow_status = 'in_review')`,
  },
]

/** The lines that need this person now, in the order above. */
export async function readTodos(actor: UserActor): Promise<TodoItem[]> {
  const todos = TODOS.filter((todo) => rolesAllow(actor.roles, todo.permission))
  if (todos.length === 0) return []
  const columns = sql.join(
    todos.map(
      (todo) => sql`${todo.countSql}::int as ${sql.identifier(todo.key)}`,
    ),
    sql`, `,
  )
  const result = await getDb().execute<Record<string, number>>(
    sql`select ${columns}`,
  )
  const row = result.rows[0] ?? {}
  return todos.flatMap(({ key, one, many, href }) => {
    const count = Number(row[key] ?? 0)
    return count > 0
      ? [{ key, count, label: `${count} ${count === 1 ? one : many}`, href }]
      : []
  })
}
