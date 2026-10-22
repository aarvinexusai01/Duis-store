import "server-only"
import { eq, sql } from "drizzle-orm"
import { z } from "zod"

import { products } from "@/db/schema"
import type { RichTextDocument } from "@/lib/rich-text"
import { slugSchema } from "@/lib/slug-schema"
import { writeAudit } from "@/server/audit"
import { getDb } from "@/server/db/client"
import { versionOf } from "@/lib/version"
import { withTransaction } from "@/server/db/transaction"
import { DomainError, isUniqueViolation } from "@/server/errors"
import { defineOperation } from "@/server/operation"

import { refreshListingCache, refreshSearchKeywords } from "./derived"
import { createSizeChartSchema } from "./schemas"

/**
 * Admin reads and the few writes the Phase 1 services did not cover
 * (doc/06 Phase 4 §3–4). Reads are operations too, so the RBAC matrix
 * covers them.
 */

export const ADMIN_PAGE_SIZE = 50

const listInput = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  categoryId: z.uuid().optional(),
  page: z.number().int().min(1).max(10_000).default(1),
})

export type AdminProductRow = {
  id: string
  title: string
  slug: string
  status: "draft" | "active" | "archived"
  imageKey: string | null
  variantCount: number
  onHand: number
  available: number
  minPricePaise: number | null
  maxPricePaise: number | null
  updatedAt: Date
}

export const adminListProducts = defineOperation({
  name: "catalog.adminListProducts",
  access: { catalog: ["read"] },
  input: listInput,
  async handler(_ctx, { q, status, categoryId, page }) {
    const like = q ? `%${q.replace(/[%_\\]/g, "\\$&")}%` : null
    const where = sql`
      ${status ? sql`and p.status = ${status}` : sql``}
      ${
        like
          ? sql`and (p.title ilike ${like} or p.slug::text ilike ${like}
                   or exists (select 1 from product_variants v where v.product_id = p.id and v.sku::text ilike ${like}))`
          : sql``
      }
      ${
        categoryId
          ? sql`and exists (select 1 from product_categories pc join categories own on own.id = pc.category_id
                        join categories anc on own.path <@ anc.path where pc.product_id = p.id and anc.id = ${categoryId})`
          : sql``
      }`
    const rows = await getDb().execute<{
      id: string
      title: string
      slug: string
      status: AdminProductRow["status"]
      image_key: string | null
      variant_count: number
      on_hand: number
      available: number
      min_price: number | null
      max_price: number | null
      updated_at: Date
      total: number
    }>(sql`
      select p.id, p.title, p.slug::text, p.status, p.updated_at,
             (select m.storage_key from product_media pm join media_assets m on m.id = pm.media_id
              where pm.product_id = p.id order by pm.position limit 1) as image_key,
             (select count(*)::int from product_variants v where v.product_id = p.id and v.status = 'active') as variant_count,
             coalesce((select sum(l.on_hand)::int from product_variants v join inventory_levels l on l.variant_id = v.id where v.product_id = p.id), 0) as on_hand,
             coalesce((select sum(l.on_hand - l.reserved)::int from product_variants v join inventory_levels l on l.variant_id = v.id where v.product_id = p.id), 0) as available,
             (select min(price_paise) from product_variants v where v.product_id = p.id and v.status = 'active') as min_price,
             (select max(price_paise) from product_variants v where v.product_id = p.id and v.status = 'active') as max_price,
             count(*) over ()::int as total
      from products p
      where true ${where}
      order by p.updated_at desc, p.id
      limit ${ADMIN_PAGE_SIZE} offset ${(page - 1) * ADMIN_PAGE_SIZE}`)
    return {
      total: rows.rows[0]?.total ?? 0,
      rows: rows.rows.map((r): AdminProductRow => ({
        id: r.id,
        title: r.title,
        slug: r.slug,
        status: r.status,
        imageKey: r.image_key,
        variantCount: r.variant_count,
        onHand: r.on_hand,
        available: r.available,
        minPricePaise: r.min_price,
        maxPricePaise: r.max_price,
        updatedAt: new Date(r.updated_at),
      })),
    }
  },
})

export type AdminProduct = {
  id: string
  /** When it was last saved; sent back on save to catch overlapping edits. */
  version: string
  departmentId: string
  slug: string
  title: string
  subtitle: string | null
  status: "draft" | "active" | "archived"
  description: RichTextDocument | null
  specifications: { label: string; value: string }[]
  material: string | null
  care: string | null
  hsnCode: string
  countryOfOrigin: string
  manufacturerDetails: string
  netQuantity: string
  weightGrams: number
  tags: string[]
  seoTitle: string | null
  seoDescription: string | null
  noindex: boolean
  categoryIds: string[]
  axisAttributeIds: string[]
  descriptiveValueIds: string[]
  variants: {
    id: string
    sku: string
    label: string
    options: Record<string, string>
    pricePaise: number
    mrpPaise: number
    status: "active" | "inactive"
    onHand: number
    reserved: number
  }[]
  media: {
    mediaId: string
    key: string
    alt: string
    colorValueId: string | null
    width: number
    height: number
  }[]
  publishedAt: Date | null
}

export const adminGetProduct = defineOperation({
  name: "catalog.adminGetProduct",
  access: { catalog: ["read"] },
  input: z.object({ id: z.uuid() }),
  async handler(_ctx, { id }): Promise<AdminProduct> {
    const db = getDb()
    const [p] = await db.select().from(products).where(eq(products.id, id))
    if (!p) throw new DomainError("NOT_FOUND", "Product not found.")
    const [cats, axes, values, variants, media] = await Promise.all([
      db.execute<{ category_id: string }>(sql`
        select category_id from product_categories where product_id = ${id} order by is_primary desc, category_id`),
      db.execute<{ attribute_id: string }>(sql`
        select attribute_id from product_attributes where product_id = ${id} order by position`),
      db.execute<{ attribute_value_id: string }>(sql`
        select attribute_value_id from product_attribute_values where product_id = ${id}`),
      db.execute<{
        id: string
        sku: string
        price_paise: number
        mrp_paise: number
        status: "active" | "inactive"
        on_hand: number
        reserved: number
        options: Record<string, string> | null
        label: string | null
      }>(sql`
        select v.id, v.sku::text, v.price_paise, v.mrp_paise, v.status,
               coalesce((select sum(on_hand)::int from inventory_levels where variant_id = v.id), 0) as on_hand,
               coalesce((select sum(reserved)::int from inventory_levels where variant_id = v.id), 0) as reserved,
               (select json_object_agg(a.code, av.slug) from variant_attribute_values vav
                join attributes a on a.id = vav.attribute_id join attribute_values av on av.id = vav.attribute_value_id
                where vav.variant_id = v.id) as options,
               (select string_agg(av.label, ' / ' order by pa.position) from variant_attribute_values vav
                join attribute_values av on av.id = vav.attribute_value_id
                left join product_attributes pa on pa.product_id = v.product_id and pa.attribute_id = vav.attribute_id
                where vav.variant_id = v.id) as label
        from product_variants v where v.product_id = ${id} order by v.position, v.sku`),
      db.execute<{
        media_id: string
        key: string
        alt: string | null
        color_value_id: string | null
        width: number
        height: number
      }>(sql`
        select pm.media_id, m.storage_key as key, coalesce(pm.alt_override, m.alt_text) as alt,
               pm.color_value_id, m.width, m.height
        from product_media pm join media_assets m on m.id = pm.media_id
        where pm.product_id = ${id} order by pm.position`),
    ])
    return {
      id: p.id,
      version: p.updatedAt.toISOString(),
      departmentId: p.departmentId,
      slug: p.slug,
      title: p.title,
      subtitle: p.subtitle,
      status: p.status,
      description: p.description as RichTextDocument | null,
      specifications: p.specifications,
      material: p.material,
      care: p.care,
      hsnCode: p.hsnCode,
      countryOfOrigin: p.countryOfOrigin,
      manufacturerDetails: p.manufacturerDetails,
      netQuantity: p.netQuantity,
      weightGrams: p.weightGrams,
      tags: p.tags,
      seoTitle: p.seoTitle,
      seoDescription: p.seoDescription,
      noindex: p.noindex,
      publishedAt: p.publishedAt,
      categoryIds: cats.rows.map((r) => r.category_id),
      axisAttributeIds: axes.rows.map((r) => r.attribute_id),
      descriptiveValueIds: values.rows.map((r) => r.attribute_value_id),
      variants: variants.rows.map((v) => ({
        id: v.id,
        sku: v.sku,
        label: v.label ?? v.sku,
        options: v.options ?? {},
        pricePaise: v.price_paise,
        mrpPaise: v.mrp_paise,
        status: v.status,
        onHand: v.on_hand,
        reserved: v.reserved,
      })),
      media: media.rows.map((m) => ({
        mediaId: m.media_id,
        key: m.key,
        alt: m.alt ?? "",
        colorValueId: m.color_value_id,
        width: m.width,
        height: m.height,
      })),
    }
  },
})

export type CatalogOptions = {
  departments: { id: string; name: string; slug: string }[]
  categories: {
    id: string
    departmentId: string
    parentId: string | null
    name: string
    slug: string
    depth: number
    position: number
    isActive: boolean
    defaultHsnCode: string | null
    sizeChartId: string | null
    description: string | null
    exchangeAllowed: boolean
    productCount: number
    /** Sent back on save to catch overlapping edits. */
    version: string
  }[]
  attributes: {
    id: string
    code: string
    name: string
    kind: "swatch" | "text"
    isVariantAxis: boolean
    isFilterable: boolean
    values: {
      id: string
      slug: string
      label: string
      swatchHex: string | null
      filterGroup: string | null
      position: number
    }[]
  }[]
  sizeCharts: { id: string; name: string; unit: "in" | "cm" }[]
}

/** Everything the catalogue forms choose from. */
export const adminCatalogOptions = defineOperation({
  name: "catalog.adminOptions",
  access: { catalog: ["read"] },
  input: z.object({}),
  async handler(): Promise<CatalogOptions> {
    const db = getDb()
    const [departments, categories, attributes, values, charts] =
      await Promise.all([
        db.execute<{ id: string; name: string; slug: string }>(
          sql`select id, name, slug::text from departments order by position, name`,
        ),
        db.execute<{
          id: string
          department_id: string
          parent_id: string | null
          name: string
          slug: string
          depth: number
          position: number
          is_active: boolean
          default_hsn_code: string | null
          exchange_allowed: boolean
          size_chart_id: string | null
          description: string | null
          product_count: number
          updated_at: Date
        }>(sql`
        select c.id, c.department_id, c.parent_id, c.name, c.slug::text, nlevel(c.path) - 1 as depth, c.position,
               c.is_active, c.default_hsn_code, c.size_chart_id, c.description, c.exchange_allowed, c.updated_at,
               (select count(*)::int from product_categories pc where pc.category_id = c.id) as product_count
        from categories c order by c.path`),
        db.execute<{
          id: string
          code: string
          name: string
          kind: "swatch" | "text"
          is_variant_axis: boolean
          is_filterable: boolean
        }>(
          sql`select id, code::text, name, kind, is_variant_axis, is_filterable from attributes order by position, name`,
        ),
        db.execute<{
          id: string
          attribute_id: string
          slug: string
          label: string
          swatch_hex: string | null
          filter_group: string | null
          position: number
        }>(
          sql`select id, attribute_id, slug::text, label, swatch_hex, filter_group::text, position from attribute_values order by position, label`,
        ),
        db.execute<{ id: string; name: string; unit: "in" | "cm" }>(
          sql`select id, name, unit from size_charts order by name`,
        ),
      ])
    return {
      departments: departments.rows,
      categories: categories.rows.map((c) => ({
        id: c.id,
        departmentId: c.department_id,
        parentId: c.parent_id,
        name: c.name,
        slug: c.slug,
        depth: c.depth,
        position: c.position,
        isActive: c.is_active,
        defaultHsnCode: c.default_hsn_code,
        exchangeAllowed: c.exchange_allowed,
        sizeChartId: c.size_chart_id,
        description: c.description,
        productCount: c.product_count,
        version: versionOf(c.updated_at),
      })),
      attributes: attributes.rows.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        kind: a.kind,
        isVariantAxis: a.is_variant_axis,
        isFilterable: a.is_filterable,
        values: values.rows
          .filter((v) => v.attribute_id === a.id)
          .map((v) => ({
            id: v.id,
            slug: v.slug,
            label: v.label,
            swatchHex: v.swatch_hex,
            filterGroup: v.filter_group,
            position: v.position,
          })),
      })),
      sizeCharts: charts.rows,
    }
  },
})

/**
 * A draft copy of a product: details, categories, axes, descriptive values
 * and photos. Variants are regenerated on the copy (new SKUs).
 */
export const duplicateProduct = defineOperation({
  name: "catalog.duplicateProduct",
  access: { catalog: ["create"] },
  input: z.object({ id: z.uuid(), slug: slugSchema }),
  async handler({ actor }, { id, slug }) {
    try {
      return await withTransaction(async (tx) => {
        const created = await tx.execute<{ id: string }>(sql`
          insert into products (department_id, slug, title, subtitle, description, description_text, specifications,
            material, care, hsn_code, country_of_origin, manufacturer_details, net_quantity, weight_grams,
            length_cm, breadth_cm, height_cm, tags, seo_title, seo_description, noindex, created_by)
          select department_id, ${slug}, title || ' (copy)', subtitle, description, description_text, specifications,
            material, care, hsn_code, country_of_origin, manufacturer_details, net_quantity, weight_grams,
            length_cm, breadth_cm, height_cm, tags, null, null, noindex, ${actor.kind === "user" ? actor.userId : null}
          from products where id = ${id}
          returning id`)
        const copy = created.rows[0]?.id
        if (!copy) throw new DomainError("NOT_FOUND", "Product not found.")
        await tx.execute(sql`insert into product_categories (product_id, category_id, is_primary)
          select ${copy}, category_id, is_primary from product_categories where product_id = ${id}`)
        await tx.execute(sql`insert into product_attributes (product_id, attribute_id, position)
          select ${copy}, attribute_id, position from product_attributes where product_id = ${id}`)
        await tx.execute(sql`insert into product_attribute_values (product_id, attribute_value_id)
          select ${copy}, attribute_value_id from product_attribute_values where product_id = ${id}`)
        await tx.execute(sql`insert into product_media (product_id, media_id, color_value_id, position, alt_override)
          select ${copy}, media_id, color_value_id, position, alt_override from product_media where product_id = ${id}`)
        await refreshSearchKeywords(tx, [copy])
        await refreshListingCache(tx, [copy])
        await writeAudit(tx, actor, {
          action: "product.duplicate",
          entityType: "product",
          entityId: copy,
          changes: { from: id, slug },
        })
        return { id: copy }
      })
    } catch (error) {
      if (isUniqueViolation(error))
        throw new DomainError(
          "CONFLICT",
          "Another product already uses that slug.",
        )
      throw error
    }
  },
})

export const updateAttributeValue = defineOperation({
  name: "catalog.updateAttributeValue",
  access: { catalog: ["update"] },
  input: z.object({
    id: z.uuid(),
    label: z.string().trim().min(1).max(120).optional(),
    swatchHex: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullish(),
    filterGroup: slugSchema.nullish(),
    position: z.number().int().min(0).optional(),
  }),
  async handler({ actor }, { id, ...changes }) {
    return withTransaction(async (tx) => {
      const updated = await tx.execute<{ id: string }>(sql`
        update attribute_values set
          label = coalesce(${changes.label ?? null}, label),
          swatch_hex = ${changes.swatchHex === undefined ? sql`swatch_hex` : changes.swatchHex},
          filter_group = ${changes.filterGroup === undefined ? sql`filter_group` : changes.filterGroup},
          position = coalesce(${changes.position ?? null}, position),
          updated_at = now()
        where id = ${id} returning id`)
      if (!updated.rows[0])
        throw new DomainError("NOT_FOUND", "Value not found.")
      // Labels and swatches show on every product that uses the value.
      const affected = await tx.execute<{ product_id: string }>(sql`
        select distinct v.product_id from variant_attribute_values vav join product_variants v on v.id = vav.variant_id
        where vav.attribute_value_id = ${id}
        union select product_id from product_attribute_values where attribute_value_id = ${id}`)
      const ids = affected.rows.map((r) => r.product_id)
      if (ids.length > 0) await refreshListingCache(tx, ids)
      await writeAudit(tx, actor, {
        action: "attribute_value.update",
        entityType: "attribute_value",
        entityId: id,
        changes,
      })
      return { id }
    })
  },
})

export const updateSizeChart = defineOperation({
  name: "catalog.updateSizeChart",
  access: { catalog: ["update"] },
  input: createSizeChartSchema.extend({ id: z.uuid() }),
  async handler({ actor }, { id, ...chart }) {
    for (const row of chart.chart.rows) {
      if (row.values.length !== chart.chart.columns.length) {
        throw new DomainError(
          "VALIDATION_FAILED",
          `Size ${row.size} needs one value per column.`,
        )
      }
    }
    return withTransaction(async (tx) => {
      const updated = await tx.execute<{ id: string }>(sql`
        update size_charts set name = ${chart.name}, unit = ${chart.unit}, chart = ${JSON.stringify(chart.chart)}::jsonb,
          how_to_measure = ${chart.howToMeasure ?? null}, updated_at = now()
        where id = ${id} returning id`)
      if (!updated.rows[0])
        throw new DomainError("NOT_FOUND", "Size chart not found.")
      await writeAudit(tx, actor, {
        action: "size_chart.update",
        entityType: "size_chart",
        entityId: id,
        changes: { name: chart.name },
      })
      return { id }
    })
  },
})

export type SizeChartRow = {
  id: string
  name: string
  unit: "in" | "cm"
  chart: { columns: string[]; rows: { size: string; values: string[] }[] }
  howToMeasure: string | null
  categoryCount: number
}

export const adminListSizeCharts = defineOperation({
  name: "catalog.adminListSizeCharts",
  access: { catalog: ["read"] },
  input: z.object({}),
  async handler(): Promise<SizeChartRow[]> {
    const rows = await getDb().execute<{
      id: string
      name: string
      unit: "in" | "cm"
      chart: SizeChartRow["chart"]
      how_to_measure: string | null
      category_count: number
    }>(sql`
      select s.id, s.name, s.unit, s.chart, s.how_to_measure,
             (select count(*)::int from categories c where c.size_chart_id = s.id) as category_count
      from size_charts s order by s.name`)
    return rows.rows.map((r) => ({
      id: r.id,
      name: r.name,
      unit: r.unit,
      chart: r.chart,
      howToMeasure: r.how_to_measure,
      categoryCount: r.category_count,
    }))
  },
})
