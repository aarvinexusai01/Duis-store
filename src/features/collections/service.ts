import "server-only"
import { and, eq, inArray, ne, sql, type SQL } from "drizzle-orm"

import { collectionProducts, collections, products } from "@/db/schema"
import { recordAddressChange, releaseAddress } from "@/features/redirects"
import { systemActor } from "@/server/auth/actor"
import { writeAudit } from "@/server/audit"
import { requestRevalidation } from "@/server/cache/revalidate"
import { cacheTags } from "@/server/cache/tags"
import { uuidArray, textArray } from "@/server/db/sql"
import { withTransaction, type Transaction } from "@/server/db/transaction"
import { checkVersion } from "@/server/db/versioning"
import { DomainError, isUniqueViolation } from "@/server/errors"
import { enqueue } from "@/server/jobs/enqueue"
import { QUEUES } from "@/server/jobs/queues"
import { defineOperation } from "@/server/operation"

import {
  collectionIdSchema,
  createCollectionSchema,
  setCollectionProductsSchema,
  updateCollectionSchema,
  type CollectionRuleInput,
} from "./schemas"

/** SQL condition on `p` (products) and `lc` (product_listing_cache). */
export function ruleCondition(rule: CollectionRuleInput): SQL {
  switch (rule.field) {
    case "price":
      return rule.operator === "lte"
        ? sql`lc.min_price_paise <= ${rule.valuePaise}`
        : sql`lc.min_price_paise >= ${rule.valuePaise}`
    case "category":
      // The category or anything below it.
      return sql`exists (
        select 1 from product_categories pc
        join categories c on c.id = pc.category_id
        join categories root on c.path <@ root.path
        where pc.product_id = p.id and root.id = any(${uuidArray(rule.categoryIds)})
      )`
    case "tag":
      return sql`p.tags && ${textArray(rule.tags)}`
    case "created_within_days":
      return sql`p.published_at >= now() - make_interval(days => ${rule.days})`
    case "attribute_value":
      return sql`lc.filter_value_ids && ${uuidArray(rule.attributeValueIds)}`
    case "best_selling":
      return sql`exists (
        select 1 from product_sales_stats s
        where s.product_id = p.id and s.rank_best_selling <= ${rule.top}
      )`
  }
}

const SORT_ORDER: Record<string, SQL> = {
  manual: sql`p.published_at desc, p.id`,
  newest: sql`p.published_at desc, p.id`,
  best_selling: sql`coalesce(s.rank_best_selling, 2147483647), p.published_at desc, p.id`,
  price_asc: sql`lc.min_price_paise asc nulls last, p.id`,
  price_desc: sql`lc.min_price_paise desc nulls last, p.id`,
}

/** Rebuilds rule-based membership for one automatic collection. */
async function refreshOne(
  tx: Transaction,
  collectionId: string,
): Promise<number> {
  const [collection] = await tx
    .select()
    .from(collections)
    .where(eq(collections.id, collectionId))
    .for("update")
  if (!collection || collection.type !== "automatic") return 0

  const conditions = collection.rules.map((rule) =>
    ruleCondition(rule as CollectionRuleInput),
  )
  const combined = sql.join(
    conditions,
    collection.ruleMatch === "any" ? sql` or ` : sql` and `,
  )

  await tx
    .delete(collectionProducts)
    .where(
      and(
        eq(collectionProducts.collectionId, collectionId),
        eq(collectionProducts.source, "rule"),
      ),
    )
  const inserted = await tx.execute(sql`
    insert into collection_products (collection_id, product_id, position, source)
    select ${collectionId}, p.id,
           (row_number() over (order by ${SORT_ORDER[collection.sortMode]}) - 1)::int,
           'rule'
    from products p
    join product_listing_cache lc on lc.product_id = p.id
    left join product_sales_stats s on s.product_id = p.id
    where p.status = 'active' and (${combined})
    on conflict (collection_id, product_id) do nothing
  `)
  // Bookkeeping, not an edit: updated_at (the editors' version) stays as it
  // was, or every catalogue change would make open editors look stale.
  await tx
    .update(collections)
    .set({
      rulesRefreshedAt: new Date(),
      updatedAt: sql`${collections.updatedAt}`,
    })
    .where(eq(collections.id, collectionId))
  return inserted.rowCount ?? 0
}

/**
 * catalog.refresh-auto-collections job: one collection, or all of them after
 * catalogue changes and nightly (new arrivals age out).
 */
export async function refreshAutomaticCollections(
  collectionId?: string,
): Promise<number> {
  return withTransaction(async (tx) => {
    const targets = collectionId
      ? [collectionId]
      : (
          await tx
            .select({ id: collections.id })
            .from(collections)
            .where(
              and(
                eq(collections.type, "automatic"),
                ne(collections.status, "archived"),
              ),
            )
        ).map((row) => row.id)

    let members = 0
    for (const id of targets) members += await refreshOne(tx, id)
    if (targets.length > 0) {
      await requestRevalidation(
        [cacheTags.collectionsList, ...targets.map(cacheTags.collection)],
        { tx },
      )
      await writeAudit(tx, systemActor("collections.refresh"), {
        action: "collection.refresh_rules",
        entityType: "collection",
        entityId: collectionId ?? null,
        changes: { collections: targets.length, members },
      })
    }
    return members
  })
}

function conflict(err: unknown): never {
  if (isUniqueViolation(err, "collections_slug_unique")) {
    throw new DomainError(
      "CONFLICT",
      "Another collection already uses that slug.",
    )
  }
  throw err
}

export const createCollection = defineOperation({
  name: "collections.createCollection",
  access: { collection: ["create"] },
  input: createCollectionSchema,
  async handler({ actor }, input) {
    return withTransaction(async (tx) => {
      const [row] = await tx
        .insert(collections)
        .values({
          ...input,
          rules: input.type === "automatic" ? input.rules : [],
          ruleMatch: input.type === "automatic" ? input.ruleMatch : "all",
          createdBy: actor.kind === "user" ? actor.userId : null,
        })
        .returning({ id: collections.id })
        .catch(conflict)
      if (input.type === "automatic") await refreshOne(tx, row!.id)
      await writeAudit(tx, actor, {
        action: "collection.create",
        entityType: "collection",
        entityId: row!.id,
        changes: { slug: input.slug, type: input.type },
      })
      return { id: row!.id }
    })
  },
})

export const updateCollection = defineOperation({
  name: "collections.updateCollection",
  access: { collection: ["update"] },
  input: updateCollectionSchema,
  async handler({ actor }, { id, expectedVersion, ...changes }) {
    return withTransaction(async (tx) => {
      await checkVersion(tx, "collections", id, expectedVersion, "collection")
      const [current] = await tx
        .select({
          type: collections.type,
          slug: collections.slug,
          publishedAt: collections.publishedAt,
        })
        .from(collections)
        .where(eq(collections.id, id))
        .for("update")
      if (!current) throw new DomainError("NOT_FOUND", "Collection not found.")
      if (current.type === "manual" && (changes.rules || changes.ruleMatch)) {
        throw new DomainError(
          "VALIDATION_FAILED",
          "Manual collections have no rules.",
        )
      }

      await tx
        .update(collections)
        .set({ ...changes, updatedAt: new Date() })
        .where(eq(collections.id, id))
        .catch(conflict)
      // A collection that has been live keeps its old address working.
      if (changes.slug && changes.slug !== current.slug) {
        if (current.publishedAt)
          await recordAddressChange(
            tx,
            `/collections/${current.slug}`,
            `/collections/${changes.slug}`,
          )
        else await releaseAddress(tx, `/collections/${changes.slug}`)
      }
      if (current.type === "automatic") await refreshOne(tx, id)
      await requestRevalidation(
        [cacheTags.collection(id), cacheTags.collectionsList],
        { tx },
      )
      await writeAudit(tx, actor, {
        action: "collection.update",
        entityType: "collection",
        entityId: id,
        changes,
      })
      return { id }
    })
  },
})

/** Replaces a manual collection's products, in the given order. */
export const setCollectionProducts = defineOperation({
  name: "collections.setCollectionProducts",
  access: { collection: ["update"] },
  input: setCollectionProductsSchema,
  async handler({ actor }, { collectionId, productIds, expectedVersion }) {
    const unique = [...new Set(productIds)]
    if (unique.length !== productIds.length) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "A product can appear only once.",
      )
    }
    return withTransaction(async (tx) => {
      await checkVersion(
        tx,
        "collections",
        collectionId,
        expectedVersion,
        "collection",
      )
      const [collection] = await tx
        .select({ type: collections.type })
        .from(collections)
        .where(eq(collections.id, collectionId))
        .for("update")
      if (!collection)
        throw new DomainError("NOT_FOUND", "Collection not found.")
      if (collection.type !== "manual") {
        throw new DomainError(
          "INVALID_STATE",
          "Automatic collections are filled by their rules.",
        )
      }
      if (unique.length > 0) {
        const found = await tx
          .select({ id: products.id })
          .from(products)
          .where(inArray(products.id, unique))
        if (found.length !== unique.length)
          throw new DomainError(
            "VALIDATION_FAILED",
            "Some products do not exist.",
          )
      }

      await tx
        .delete(collectionProducts)
        .where(eq(collectionProducts.collectionId, collectionId))
      if (unique.length > 0) {
        await tx.insert(collectionProducts).values(
          unique.map((productId, position) => ({
            collectionId,
            productId,
            position,
            source: "manual" as const,
          })),
        )
      }
      // The product list is part of the collection: its version moves on.
      await tx
        .update(collections)
        .set({ updatedAt: new Date() })
        .where(eq(collections.id, collectionId))
      // collectionsList too: CMS pages (the home page's "Best sellers"
      // section) are cached under it, as for every other collection change.
      await requestRevalidation(
        [cacheTags.collection(collectionId), cacheTags.collectionsList],
        { tx },
      )
      await writeAudit(tx, actor, {
        action: "collection.set_products",
        entityType: "collection",
        entityId: collectionId,
        changes: { count: unique.length },
      })
      return { count: unique.length }
    })
  },
})

export const publishCollection = defineOperation({
  name: "collections.publishCollection",
  access: { collection: ["publish"] },
  input: collectionIdSchema,
  async handler({ actor }, { id }) {
    return withTransaction(async (tx) => {
      const [row] = await tx
        .update(collections)
        .set({
          status: "published",
          publishedAt: sql`coalesce(${collections.publishedAt}, now())`,
        })
        .where(eq(collections.id, id))
        .returning({ id: collections.id })
      if (!row) throw new DomainError("NOT_FOUND", "Collection not found.")
      await requestRevalidation(
        [cacheTags.collection(id), cacheTags.collectionsList],
        { tx },
      )
      await writeAudit(tx, actor, {
        action: "collection.publish",
        entityType: "collection",
        entityId: id,
      })
      return { id }
    })
  },
})

/**
 * Pages and menus (live, or waiting to go live) that use a collection.
 * Archiving is refused while any do (owner decision 2026-10-17).
 */
export async function collectionUsage(
  db: Transaction,
  collectionId: string,
): Promise<{ kind: string; label: string; href: string }[]> {
  const found = await db.execute<{
    kind: string
    label: string
    href: string
  }>(sql`
    select distinct
      case rev.entity_type when 'page' then 'Page' when 'navigation' then 'Menu' else 'Content' end as kind,
      coalesce(pg.title, nm.name, 'Content') as label,
      case rev.entity_type when 'page' then '/admin/cms/pages/' || pg.id
        when 'navigation' then '/admin/cms/navigation/' || nm.key else '/admin/cms' end as href
    from cms_revision_refs r
    join cms_revisions rev on rev.id = r.revision_id
    left join cms_pages pg on rev.entity_type = 'page' and pg.id = rev.entity_id
    left join navigation_menus nm on rev.entity_type = 'navigation' and nm.id = rev.entity_id
    where r.collection_id = ${collectionId}
      and (rev.workflow_status in ('draft', 'in_review', 'approved', 'scheduled')
           and (pg.draft_revision_id = rev.id or nm.draft_revision_id = rev.id)
        or pg.published_revision_id = rev.id or nm.published_revision_id = rev.id)`)
  return found.rows
}

export const archiveCollection = defineOperation({
  name: "collections.archiveCollection",
  access: { collection: ["archive"] },
  input: collectionIdSchema,
  async handler({ actor }, { id }) {
    return withTransaction(async (tx) => {
      const usage = await collectionUsage(tx, id)
      if (usage.length > 0) {
        const names = usage
          .slice(0, 3)
          .map((use) => `${use.kind} "${use.label}"`)
          .join(", ")
        const more = usage.length > 3 ? ` and ${usage.length - 3} more` : ""
        throw new DomainError(
          "CONFLICT",
          `This collection is still used by ${names}${more}. Remove it there first.`,
          { usage },
        )
      }
      const [row] = await tx
        .update(collections)
        .set({ status: "archived" })
        .where(eq(collections.id, id))
        .returning({ id: collections.id })
      if (!row) throw new DomainError("NOT_FOUND", "Collection not found.")
      await requestRevalidation(
        [cacheTags.collection(id), cacheTags.collectionsList],
        { tx },
      )
      await writeAudit(tx, actor, {
        action: "collection.archive",
        entityType: "collection",
        entityId: id,
      })
      return { id }
    })
  },
})

/** Queues a refresh of every automatic collection (catalogue changed). */
export async function scheduleCollectionRefresh(
  tx?: Transaction,
): Promise<void> {
  await enqueue(
    QUEUES.refreshAutoCollections,
    {},
    { tx, singletonKey: "all-auto-collections" },
  )
}
