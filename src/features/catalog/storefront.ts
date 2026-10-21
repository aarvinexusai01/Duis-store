import "server-only"
import { sql, type SQL } from "drizzle-orm"

import type { RichTextDocument } from "@/lib/rich-text"
import {
  PAGE_SIZE,
  type FacetKey,
  type ListingParams,
} from "@/lib/listing-params"
import { getDb } from "@/server/db/client"
import { uuidArray } from "@/server/db/sql"

import type { SizeChartData, Specification } from "@/db/schema"

/**
 * Storefront reads (uncached). ./queries.ts wraps them in "use cache" with
 * tags; tests call these directly. Only active products and categories are
 * ever returned.
 */

export type MediaRef = {
  key: string
  width: number
  height: number
  alt: string
  /** Where to keep in frame when cropped (0–1); centre when absent. */
  focal?: { x: number; y: number }
}

export type ProductCard = {
  id: string
  slug: string
  title: string
  pricePaise: number
  maxPricePaise: number
  mrpPaise: number
  discountPercent: number
  inStock: boolean
  image: MediaRef | null
  hoverImage: MediaRef | null
  colours: { slug: string; label: string; hex: string | null }[]
  /** Approved reviews only; null when there are none. */
  rating: { average: number; count: number } | null
}

export type CategoryNode = {
  id: string
  parentId: string | null
  departmentSlug: string
  name: string
  slug: string
  href: string
  path: string
  depth: number
  position: number
  sizeChartId: string | null
  description: string | null
  seoTitle: string | null
  seoDescription: string | null
  noindex: boolean
}

export type Department = {
  id: string
  slug: string
  name: string
  href: string
}

export type CatalogTree = {
  departments: Department[]
  categories: CategoryNode[]
}

const rows = <T>(result: { rows: unknown[] }) => result.rows as T[]

export async function loadCatalogTree(): Promise<CatalogTree> {
  const db = getDb()
  const departments = rows<{ id: string; slug: string; name: string }>(
    await db.execute(sql`
      select id, slug::text, name from departments where is_active order by position, name
    `),
  ).map((d) => ({ ...d, href: `/shop/${d.slug}` }))

  const raw = rows<{
    id: string
    parent_id: string | null
    department_slug: string
    name: string
    slug: string
    path: string
    depth: number
    position: number
    size_chart_id: string | null
    description: string | null
    seo_title: string | null
    seo_description: string | null
    noindex: boolean
  }>(
    await db.execute(sql`
      select c.id, c.parent_id, d.slug::text as department_slug, c.name, c.slug::text,
             c.path::text, nlevel(c.path) as depth, c.position, c.size_chart_id,
             c.description, c.seo_title, c.seo_description, c.noindex
      from categories c
      join departments d on d.id = c.department_id
      where c.is_active and d.is_active
      order by nlevel(c.path), c.position, c.name
    `),
  )

  const byId = new Map(raw.map((row) => [row.id, row]))
  const slugPath = (row: (typeof raw)[number]): string[] => {
    const parent = row.parent_id ? byId.get(row.parent_id) : undefined
    return parent ? [...slugPath(parent), row.slug] : [row.slug]
  }

  const categories = raw
    // Drop children of inactive parents (their parent is missing here).
    .filter((row) => !row.parent_id || byId.has(row.parent_id))
    .map((row) => ({
      id: row.id,
      parentId: row.parent_id,
      departmentSlug: row.department_slug,
      name: row.name,
      slug: row.slug,
      href: `/shop/${row.department_slug}/${slugPath(row).join("/")}`,
      path: row.path,
      depth: row.depth,
      position: row.position,
      sizeChartId: row.size_chart_id,
      description: row.description,
      seoTitle: row.seo_title,
      seoDescription: row.seo_description,
      noindex: row.noindex,
    }))
  return { departments, categories }
}

export type ShopLocation =
  | { kind: "all" }
  | { kind: "department"; department: Department }
  | {
      kind: "category"
      department: Department
      category: CategoryNode
      trail: CategoryNode[]
    }

/** /shop/men/t-shirts/oversized-t-shirts → department + category + trail. */
export function resolveShopLocation(
  tree: CatalogTree,
  slugs: string[],
): ShopLocation | null {
  if (slugs.length === 0) return { kind: "all" }
  const department = tree.departments.find((d) => d.slug === slugs[0])
  if (!department) return null
  if (slugs.length === 1) return { kind: "department", department }

  const trail: CategoryNode[] = []
  let parentId: string | null = null
  for (const slug of slugs.slice(1)) {
    const next = tree.categories.find(
      (c) =>
        c.departmentSlug === department.slug &&
        c.parentId === parentId &&
        c.slug === slug,
    )
    if (!next) return null
    trail.push(next)
    parentId = next.id
  }
  return { kind: "category", department, category: trail.at(-1)!, trail }
}

// --- Listings --------------------------------------------------------------

export type ListingScope =
  | { kind: "all" }
  | { kind: "department"; departmentSlug: string }
  | { kind: "category"; categoryPath: string }
  | { kind: "collection"; collectionId: string }
  | { kind: "search"; query: string }

export type FacetOption = {
  value: string
  label: string
  count: number
  hex?: string | null
}

export type Listing = {
  items: ProductCard[]
  total: number
  page: number
  pageCount: number
  facets: Record<FacetKey, FacetOption[]>
  priceRange: { minPaise: number; maxPaise: number } | null
}

type FacetValue = {
  id: string
  code: string
  slug: string
  label: string
  hex: string | null
  group: string | null
  position: number
}

async function loadFacetValues(): Promise<FacetValue[]> {
  return rows<FacetValue>(
    await getDb().execute(sql`
      select v.id, a.code::text as code, v.slug::text as slug, v.label, v.swatch_hex as hex,
             -- A colour without a family is its own family.
             coalesce(v.filter_group, v.slug)::text as "group", v.position
      from attribute_values v
      join attributes a on a.id = v.attribute_id
      where a.is_filterable and a.code in ('color', 'size', 'fit', 'pattern', 'sleeve')
      order by a.code, v.position, v.id
    `),
  )
}

function scopeCondition(scope: ListingScope): SQL {
  switch (scope.kind) {
    case "all":
      return sql`true`
    case "department":
      return sql`p.department_id = (select id from departments where slug = ${scope.departmentSlug})`
    case "category":
      return sql`exists (
        select 1 from product_categories pc
        join categories c on c.id = pc.category_id
        where pc.product_id = p.id and c.path <@ ${scope.categoryPath}::ltree
      )`
    case "collection":
      return sql`exists (
        select 1 from collection_products cp
        where cp.product_id = p.id and cp.collection_id = ${scope.collectionId}
      )`
    case "search":
      return sql`(p.search_vector @@ websearch_to_tsquery('english', ${scope.query}) or p.title % ${scope.query})`
  }
}

function valueIds(
  values: FacetValue[],
  key: FacetKey,
  slugs: string[],
): string[] {
  if (key === "color") {
    return values
      .filter((v) => v.code === "color" && v.group && slugs.includes(v.group))
      .map((v) => v.id)
  }
  return values
    .filter((v) => v.code === key && slugs.includes(v.slug))
    .map((v) => v.id)
}

/** Conditions for every active filter, optionally leaving one facet out. */
function filterConditions(
  params: ListingParams,
  values: FacetValue[],
  except?: FacetKey | "price",
): SQL[] {
  const conditions: SQL[] = []
  for (const key of ["color", "size", "fit", "pattern", "sleeve"] as const) {
    if (key === except || params[key].length === 0) continue
    const ids = valueIds(values, key, params[key])
    // Sizes filter on what is in stock now; everything else on what exists.
    const column =
      key === "size" ? sql`lc.in_stock_value_ids` : sql`lc.filter_value_ids`
    conditions.push(
      ids.length > 0 ? sql`${column} && ${uuidArray(ids)}` : sql`false`,
    )
  }
  if (except !== "price") {
    if (params.priceMinPaise !== null)
      conditions.push(sql`lc.min_price_paise >= ${params.priceMinPaise}`)
    if (params.priceMaxPaise !== null)
      conditions.push(sql`lc.min_price_paise <= ${params.priceMaxPaise}`)
  }
  if (params.available) conditions.push(sql`lc.in_stock`)
  return conditions
}

function orderBy(scope: ListingScope, params: ListingParams): SQL {
  switch (params.sort) {
    case "newest":
      return sql`p.published_at desc, p.id`
    case "price_asc":
      return sql`lc.min_price_paise asc, p.id`
    case "price_desc":
      return sql`lc.min_price_paise desc, p.id`
    case "discount":
      return sql`lc.max_discount_percent desc, lc.min_price_paise asc, p.id`
    default:
      if (scope.kind === "collection") {
        return sql`(select cp.position from collection_products cp where cp.product_id = p.id and cp.collection_id = ${scope.collectionId}), p.id`
      }
      if (scope.kind === "search") {
        return sql`ts_rank(p.search_vector, websearch_to_tsquery('english', ${scope.query})) + similarity(p.title, ${scope.query}) desc, p.id`
      }
      // In-stock first, newest first.
      return sql`lc.in_stock desc, p.published_at desc, p.id`
  }
}

const BASE = sql`products p join product_listing_cache lc on lc.product_id = p.id`

export async function loadListing(
  scope: ListingScope,
  params: ListingParams,
): Promise<Listing> {
  const db = getDb()
  const values = await loadFacetValues()
  const where = (conditions: SQL[]) =>
    sql.join(
      [sql`p.status = 'active'`, scopeCondition(scope), ...conditions],
      sql` and `,
    )

  const page = rows<{ id: string; total: number }>(
    await db.execute(sql`
      select p.id, count(*) over ()::int as total
      from ${BASE}
      where ${where(filterConditions(params, values))}
      order by ${orderBy(scope, params)}
      limit ${PAGE_SIZE} offset ${(params.page - 1) * PAGE_SIZE}
    `),
  )
  const total = page[0]?.total ?? 0
  const items = await loadProductCards(page.map((row) => row.id))

  const facets = {} as Record<FacetKey, FacetOption[]>
  for (const key of ["color", "size", "fit", "pattern", "sleeve"] as const) {
    const column =
      key === "size" ? sql`lc.in_stock_value_ids` : sql`lc.filter_value_ids`
    const counts = rows<{ value_id: string; count: number }>(
      await db.execute(sql`
        select value_id, count(*)::int as count
        from ${BASE} cross join lateral unnest(${column}) as value_id
        where ${where(filterConditions(params, values, key))}
        group by value_id
      `),
    )
    const countById = new Map(counts.map((row) => [row.value_id, row.count]))
    const facetValues = values.filter((v) => v.code === key)

    if (key === "color") {
      // One option per colour family (Navy and Sky are both "blue").
      const groups = new Map<string, FacetOption>()
      for (const value of facetValues) {
        if (!value.group) continue
        const option = groups.get(value.group) ?? {
          value: value.group,
          label: value.group[0]!.toUpperCase() + value.group.slice(1),
          count: 0,
          hex: value.hex,
        }
        // A product with two blues counts once per family: approximate by max.
        option.count = Math.max(option.count, countById.get(value.id) ?? 0)
        groups.set(value.group, option)
      }
      facets.color = [...groups.values()].filter(
        (option) => option.count > 0 || params.color.includes(option.value),
      )
    } else {
      facets[key] = facetValues
        .map((value) => ({
          value: value.slug,
          label: value.label,
          count: countById.get(value.id) ?? 0,
        }))
        .filter(
          (option) => option.count > 0 || params[key].includes(option.value),
        )
    }
  }

  const [range] = rows<{ min: number | null; max: number | null }>(
    await db.execute(sql`
      select min(lc.min_price_paise)::int as min, max(lc.max_price_paise)::int as max
      from ${BASE}
      where ${where(filterConditions(params, values, "price"))}
    `),
  )

  return {
    items,
    total,
    page: params.page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    facets,
    priceRange:
      range?.min != null && range.max != null
        ? { minPaise: range.min, maxPaise: range.max }
        : null,
  }
}

// --- Product cards -----------------------------------------------------------

type CardRow = {
  id: string
  slug: string
  title: string
  min_price: number
  max_price: number
  mrp: number
  in_stock: boolean
  image_key: string | null
  image_width: number | null
  image_height: number | null
  image_alt: string | null
  hover_key: string | null
  hover_width: number | null
  hover_height: number | null
  hover_alt: string | null
  colours: { slug: string; label: string; hex: string | null }[] | null
  rating_count: number
  rating_average: number
}

function media(
  key: string | null,
  width: number | null,
  height: number | null,
  alt: string | null,
): MediaRef | null {
  return key && width && height ? { key, width, height, alt: alt ?? "" } : null
}

/** Cards in the order of `ids` (missing or inactive products are skipped). */
export async function loadProductCards(
  ids: readonly string[],
): Promise<ProductCard[]> {
  if (ids.length === 0) return []
  const result = rows<CardRow>(
    await getDb().execute(sql`
      select p.id, p.slug::text, p.title, p.rating_count, p.rating_average,
             lc.min_price_paise as min_price, lc.max_price_paise as max_price, lc.in_stock,
             (select v.mrp_paise from product_variants v
              where v.product_id = p.id and v.status = 'active'
              order by v.price_paise, v.position limit 1) as mrp,
             pm.storage_key as image_key, pm.width as image_width, pm.height as image_height, pm.alt_text as image_alt,
             hm.storage_key as hover_key, hm.width as hover_width, hm.height as hover_height, hm.alt_text as hover_alt,
             (select json_agg(json_build_object('slug', av.slug, 'label', av.label, 'hex', av.swatch_hex) order by av.position)
              from attribute_values av where av.id = any(lc.color_value_ids)) as colours
      from products p
      join product_listing_cache lc on lc.product_id = p.id
      left join media_assets pm on pm.id = lc.primary_media_id
      left join media_assets hm on hm.id = lc.hover_media_id
      where p.id = any(${uuidArray(ids)}) and p.status = 'active' and lc.min_price_paise is not null
    `),
  )
  const byId = new Map(result.map((row) => [row.id, row]))
  return ids.flatMap((id) => {
    const row = byId.get(id)
    if (!row) return []
    return [
      {
        id: row.id,
        slug: row.slug,
        title: row.title,
        pricePaise: row.min_price,
        maxPricePaise: row.max_price,
        mrpPaise: row.mrp,
        discountPercent:
          row.mrp > row.min_price
            ? Math.floor(((row.mrp - row.min_price) * 100) / row.mrp)
            : 0,
        inStock: row.in_stock,
        image: media(
          row.image_key,
          row.image_width,
          row.image_height,
          row.image_alt,
        ),
        hoverImage: media(
          row.hover_key,
          row.hover_width,
          row.hover_height,
          row.hover_alt,
        ),
        colours: row.colours ?? [],
        rating:
          row.rating_count > 0
            ? { average: row.rating_average / 100, count: row.rating_count }
            : null,
      },
    ]
  })
}

/** Newest active products, optionally within a category subtree. */
export async function loadNewestProductIds(
  limit: number,
  categoryPath?: string,
): Promise<string[]> {
  return rows<{ id: string }>(
    await getDb().execute(sql`
      select p.id from ${BASE}
      where p.status = 'active' and lc.min_price_paise is not null
        ${categoryPath ? sql`and ${scopeCondition({ kind: "category", categoryPath })}` : sql``}
      order by lc.in_stock desc, p.published_at desc, p.id
      limit ${limit}
    `),
  ).map((row) => row.id)
}

/** Best sellers by recent sales; falls back to newest until there are orders. */
export async function loadRankedProductIds(
  rank: "best_selling" | "trending",
  limit: number,
): Promise<string[]> {
  const column =
    rank === "best_selling" ? sql`s.rank_best_selling` : sql`s.rank_trending`
  const ranked = rows<{ id: string }>(
    await getDb().execute(sql`
      select p.id from ${BASE}
      join product_sales_stats s on s.product_id = p.id
      where p.status = 'active' and ${column} is not null
      order by ${column}, p.id
      limit ${limit}
    `),
  ).map((row) => row.id)
  return ranked.length > 0 ? ranked : loadNewestProductIds(limit)
}

// --- Search suggestions --------------------------------------------------------

export type Suggestions = {
  products: {
    slug: string
    title: string
    pricePaise: number
    image: MediaRef | null
  }[]
  categories: { name: string; href: string }[]
}

/** Prefix search for the header box: "overs" finds "Oversized …". */
export async function loadSuggestions(
  query: string,
  tree: CatalogTree,
): Promise<Suggestions> {
  const words =
    query
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.slice(0, 5) ?? []
  if (words.length === 0) return { products: [], categories: [] }
  const tsquery = words.map((word) => `${word}:*`).join(" & ")

  const ids = rows<{ id: string }>(
    await getDb().execute(sql`
      select p.id from products p
      where p.status = 'active'
        and (p.search_vector @@ to_tsquery('english', ${tsquery}) or p.title % ${query})
      order by ts_rank(p.search_vector, to_tsquery('english', ${tsquery})) + similarity(p.title, ${query}) desc, p.id
      limit 6
    `),
  ).map((row) => row.id)
  const cards = await loadProductCards(ids)

  const needle = words.join(" ")
  const categories = tree.categories
    .filter(
      (c) =>
        c.name.toLowerCase().includes(needle) ||
        words.every((w) => c.name.toLowerCase().includes(w)),
    )
    .slice(0, 4)
    .map((c) => ({ name: c.name, href: c.href }))

  return {
    products: cards.map((card) => ({
      slug: card.slug,
      title: card.title,
      pricePaise: card.pricePaise,
      image: card.image,
    })),
    categories,
  }
}

// --- Product detail -------------------------------------------------------------

export type ProductAxis = {
  code: string
  name: string
  values: { id: string; slug: string; label: string; hex: string | null }[]
}

export type ProductVariantSummary = {
  id: string
  sku: string
  pricePaise: number
  mrpPaise: number
  // axis code → value slug, e.g. { color: "black", size: "m" }
  options: Record<string, string>
}

export type ProductDetail = {
  id: string
  slug: string
  title: string
  subtitle: string | null
  description: RichTextDocument | null
  descriptionText: string
  specifications: Specification[]
  material: string | null
  care: string | null
  hsnCode: string
  countryOfOrigin: string
  manufacturerDetails: string
  netQuantity: string
  tags: string[]
  seoTitle: string | null
  seoDescription: string | null
  noindex: boolean
  primaryCategoryId: string | null
  axes: ProductAxis[]
  variants: ProductVariantSummary[]
  media: (MediaRef & { colorSlug: string | null })[]
  sizeChart: {
    name: string
    unit: string
    chart: SizeChartData
    howToMeasure: string | null
  } | null
  descriptiveValues: { code: string; label: string }[]
}

export async function loadProductDetail(
  slug: string,
): Promise<ProductDetail | null> {
  const db = getDb()
  const [product] = rows<{
    id: string
    slug: string
    title: string
    subtitle: string | null
    description: RichTextDocument | null
    description_text: string
    specifications: Specification[]
    material: string | null
    care: string | null
    hsn_code: string
    country_of_origin: string
    manufacturer_details: string
    net_quantity: string
    tags: string[]
    seo_title: string | null
    seo_description: string | null
    noindex: boolean
    primary_category_id: string | null
  }>(
    await db.execute(sql`
      select p.id, p.slug::text, p.title, p.subtitle, p.description, p.description_text, p.specifications,
             p.material, p.care, p.hsn_code, p.country_of_origin, p.manufacturer_details, p.net_quantity,
             p.tags, p.seo_title, p.seo_description, p.noindex,
             (select pc.category_id from product_categories pc where pc.product_id = p.id and pc.is_primary) as primary_category_id
      from products p
      where p.slug = ${slug} and p.status = 'active'
    `),
  )
  if (!product) return null

  const variantRows = rows<{
    id: string
    sku: string
    price: number
    mrp: number
    code: string
    value_slug: string
  }>(
    await db.execute(sql`
      select v.id, v.sku::text, v.price_paise as price, v.mrp_paise as mrp, a.code::text as code, av.slug::text as value_slug
      from product_variants v
      join variant_attribute_values vav on vav.variant_id = v.id
      join attributes a on a.id = vav.attribute_id
      join attribute_values av on av.id = vav.attribute_value_id
      where v.product_id = ${product.id} and v.status = 'active'
      order by v.position
    `),
  )
  const variants = new Map<string, ProductVariantSummary>()
  for (const row of variantRows) {
    const variant = variants.get(row.id) ?? {
      id: row.id,
      sku: row.sku,
      pricePaise: row.price,
      mrpPaise: row.mrp,
      options: {},
    }
    variant.options[row.code] = row.value_slug
    variants.set(row.id, variant)
  }

  // Axes in product order, values in their global display order, only values
  // that some active variant uses.
  const axisRows = rows<{
    code: string
    name: string
    id: string
    slug: string
    label: string
    hex: string | null
  }>(
    await db.execute(sql`
      select a.code::text as code, a.name, av.id, av.slug::text as slug, av.label, av.swatch_hex as hex
      from product_attributes pa
      join attributes a on a.id = pa.attribute_id
      join attribute_values av on av.attribute_id = a.id
      where pa.product_id = ${product.id}
        and exists (
          select 1 from variant_attribute_values vav
          join product_variants v on v.id = vav.variant_id
          where v.product_id = ${product.id} and v.status = 'active' and vav.attribute_value_id = av.id
        )
      order by pa.position, av.position, av.id
    `),
  )
  const axes: ProductAxis[] = []
  for (const row of axisRows) {
    let axis = axes.find((item) => item.code === row.code)
    if (!axis) {
      axis = { code: row.code, name: row.name, values: [] }
      axes.push(axis)
    }
    axis.values.push({
      id: row.id,
      slug: row.slug,
      label: row.label,
      hex: row.hex,
    })
  }

  const mediaRows = rows<{
    key: string
    width: number
    height: number
    alt: string
    alt_override: string | null
    color_slug: string | null
  }>(
    await db.execute(sql`
      select m.storage_key as key, m.width, m.height, m.alt_text as alt, pm.alt_override, cv.slug::text as color_slug
      from product_media pm
      join media_assets m on m.id = pm.media_id
      left join attribute_values cv on cv.id = pm.color_value_id
      where pm.product_id = ${product.id} and m.deleted_at is null
      order by pm.position, pm.id
    `),
  )

  // Nearest size chart on the primary category or its ancestors.
  const [chart] = product.primary_category_id
    ? rows<{
        name: string
        unit: string
        chart: SizeChartData
        how_to_measure: string | null
      }>(
        await db.execute(sql`
          select sc.name, sc.unit, sc.chart, sc.how_to_measure
          from categories c
          join categories ancestor on ancestor.path @> c.path
          join size_charts sc on sc.id = ancestor.size_chart_id
          where c.id = ${product.primary_category_id}
          order by nlevel(ancestor.path) desc
          limit 1
        `),
      )
    : []

  const descriptiveValues = rows<{ code: string; label: string }>(
    await db.execute(sql`
      select a.code::text as code, av.label
      from product_attribute_values pav
      join attribute_values av on av.id = pav.attribute_value_id
      join attributes a on a.id = av.attribute_id
      where pav.product_id = ${product.id}
      order by a.position, av.position, av.id
    `),
  )

  return {
    id: product.id,
    slug: product.slug,
    title: product.title,
    subtitle: product.subtitle,
    description: product.description,
    descriptionText: product.description_text,
    specifications: product.specifications,
    material: product.material,
    care: product.care,
    hsnCode: product.hsn_code,
    countryOfOrigin: product.country_of_origin,
    manufacturerDetails: product.manufacturer_details,
    netQuantity: product.net_quantity,
    tags: product.tags,
    seoTitle: product.seo_title,
    seoDescription: product.seo_description,
    noindex: product.noindex,
    primaryCategoryId: product.primary_category_id,
    axes,
    variants: [...variants.values()],
    media: mediaRows.map((row) => ({
      key: row.key,
      width: row.width,
      height: row.height,
      alt: row.alt_override ?? row.alt,
      colorSlug: row.color_slug,
    })),
    sizeChart: chart
      ? {
          name: chart.name,
          unit: chart.unit,
          chart: chart.chart,
          howToMeasure: chart.how_to_measure,
        }
      : null,
    descriptiveValues,
  }
}

/** Other products from the same category tree, in-stock first. */
export async function loadRelatedProductIds(
  productId: string,
  limit = 8,
): Promise<string[]> {
  return rows<{ id: string }>(
    await getDb().execute(sql`
      with home as (
        select c.path from product_categories pc
        join categories c on c.id = pc.category_id
        where pc.product_id = ${productId} and pc.is_primary
      )
      select p.id from ${BASE}
      where p.status = 'active' and p.id <> ${productId}
        and exists (
          select 1 from product_categories pc
          join categories c on c.id = pc.category_id, home
          where pc.product_id = p.id and c.path <@ subpath(home.path, 0, greatest(nlevel(home.path) - 1, 1))
        )
      order by lc.in_stock desc, p.published_at desc, p.id
      limit ${limit}
    `),
  ).map((row) => row.id)
}

/** Product slugs, for building links (navigation, CMS blocks). */
export async function loadProductSlugs(
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const result = rows<{ id: string; slug: string }>(
    await getDb().execute(
      sql`select id, slug::text from products where id = any(${uuidArray(ids)}) and status = 'active'`,
    ),
  )
  return new Map(result.map((row) => [row.id, row.slug]))
}

/** Media by id, for CMS blocks. Deleted media is skipped. */
export async function loadMediaRefs(
  ids: readonly string[],
): Promise<Map<string, MediaRef>> {
  if (ids.length === 0) return new Map()
  const result = rows<{
    id: string
    key: string
    width: number
    height: number
    alt: string
    focal_x: number
    focal_y: number
  }>(
    await getDb().execute(sql`
      select id, storage_key as key, width, height, alt_text as alt, focal_x, focal_y
      from media_assets where id = any(${uuidArray(ids)}) and deleted_at is null
    `),
  )
  return new Map(
    result.map((row) => [
      row.id,
      {
        key: row.key,
        width: row.width,
        height: row.height,
        alt: row.alt,
        ...(row.focal_x !== 0.5 || row.focal_y !== 0.5
          ? { focal: { x: row.focal_x, y: row.focal_y } }
          : {}),
      },
    ]),
  )
}

/** Sitemap entries for active products. */
export async function loadProductSitemap(): Promise<
  { slug: string; updatedAt: Date }[]
> {
  return rows<{ slug: string; updated_at: Date }>(
    await getDb().execute(sql`
      select slug::text, updated_at from products where status = 'active' and not noindex order by published_at desc
    `),
  ).map((row) => ({ slug: row.slug, updatedAt: new Date(row.updated_at) }))
}
