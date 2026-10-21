import "server-only"
import { sql } from "drizzle-orm"

import {
  loadMediaRefs,
  loadProductCards,
  type MediaRef,
  type ProductCard,
} from "@/features/catalog"
import type { RichTextDocument } from "@/lib/rich-text"
import { getDb } from "@/server/db/client"

import { blogPostDataSchema, type BlogPostData } from "./journal-schemas"

/** Storefront reads for the Journal (doc/06 Phase 6c). Uncached loaders. */

export const JOURNAL_PAGE_SIZE = 12

export type JournalCard = {
  id: string
  slug: string
  title: string
  excerpt: string | null
  cover: MediaRef | null
  author: { name: string; slug: string } | null
  category: { name: string; slug: string } | null
  publishedAt: Date
  readingMinutes: number
}

type CardRow = {
  id: string
  slug: string
  title: string
  excerpt: string | null
  cover_media_id: string | null
  author_name: string | null
  author_slug: string | null
  category_name: string | null
  category_slug: string | null
  published_at: Date
  reading_minutes: number
}

const CARD_COLUMNS = sql`
  p.id, p.slug::text, p.title, p.excerpt, p.cover_media_id, a.name as author_name,
  a.slug::text as author_slug, c.name as category_name, c.slug::text as category_slug,
  p.published_at, p.reading_minutes`

async function toCards(rows: CardRow[]): Promise<JournalCard[]> {
  const media = await loadMediaRefs(
    rows.flatMap((r) => (r.cover_media_id ? [r.cover_media_id] : [])),
  )
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    excerpt: r.excerpt,
    cover: r.cover_media_id ? (media.get(r.cover_media_id) ?? null) : null,
    author:
      r.author_name && r.author_slug
        ? { name: r.author_name, slug: r.author_slug }
        : null,
    category:
      r.category_name && r.category_slug
        ? { name: r.category_name, slug: r.category_slug }
        : null,
    publishedAt: new Date(r.published_at),
    readingMinutes: r.reading_minutes,
  }))
}

export type JournalFilter =
  { kind: "all" } | { kind: "category" | "tag" | "author"; slug: string }

export async function loadJournalList(
  filter: JournalFilter,
  page = 1,
): Promise<{ posts: JournalCard[]; total: number }> {
  const where =
    filter.kind === "category"
      ? sql`and c.slug = ${filter.slug}`
      : filter.kind === "author"
        ? sql`and a.slug = ${filter.slug}`
        : filter.kind === "tag"
          ? sql`and exists (select 1 from blog_post_tags pt join blog_tags t on t.id = pt.tag_id
                  where pt.post_id = p.id and t.slug = ${filter.slug})`
          : sql``
  const result = await getDb().execute<CardRow & { total: number }>(sql`
    select ${CARD_COLUMNS}, count(*) over ()::int as total
    from blog_posts p
    left join blog_authors a on a.id = p.author_id
    left join blog_categories c on c.id = p.category_id
    where p.status = 'published' ${where}
    order by p.published_at desc
    limit ${JOURNAL_PAGE_SIZE} offset ${(page - 1) * JOURNAL_PAGE_SIZE}`)
  return {
    total: result.rows[0]?.total ?? 0,
    posts: await toCards(result.rows),
  }
}

export type JournalTerm = {
  kind: "category" | "tag" | "author"
  slug: string
  name: string
  description: string | null
  photo: MediaRef | null
}

/** A category, tag or author by address, or null. */
export async function loadJournalTerm(
  kind: JournalTerm["kind"],
  slug: string,
): Promise<JournalTerm | null> {
  const found = await getDb().execute<{
    slug: string
    name: string
    description: string | null
    photo_media_id: string | null
  }>(
    kind === "category"
      ? sql`select slug::text, name, description, null as photo_media_id from blog_categories where slug = ${slug}`
      : kind === "tag"
        ? sql`select slug::text, name, null as description, null as photo_media_id from blog_tags where slug = ${slug}`
        : sql`select slug::text, name, bio as description, photo_media_id from blog_authors where slug = ${slug}`,
  )
  const row = found.rows[0]
  if (!row) return null
  const photo = row.photo_media_id
    ? ((await loadMediaRefs([row.photo_media_id])).get(row.photo_media_id) ??
      null)
    : null
  return {
    kind,
    slug: row.slug,
    name: row.name,
    description: row.description,
    photo,
  }
}

/** Categories that have live posts, for the Journal's tabs. */
export async function loadJournalCategories(): Promise<
  { name: string; slug: string }[]
> {
  const found = await getDb().execute<{ name: string; slug: string }>(sql`
    select c.name, c.slug::text from blog_categories c
    where exists (select 1 from blog_posts p where p.category_id = c.id and p.status = 'published')
    order by c.position, c.name`)
  return found.rows
}

export type ResolvedPostBlock =
  | { id: string; type: "text"; content: RichTextDocument }
  | { id: string; type: "image"; image: MediaRef; caption?: string }
  | { id: string; type: "products"; heading?: string; products: ProductCard[] }
  | { id: string; type: "youtube"; videoId: string; title?: string }
  | { id: string; type: "instagram"; url: string }

export type JournalPost = JournalCard & {
  body: ResolvedPostBlock[]
  tags: { name: string; slug: string }[]
  authorProfile: {
    name: string
    slug: string
    bio: string | null
    photo: MediaRef | null
  } | null
  seo: BlogPostData["seo"]
  ogImage: MediaRef | null
  updatedAt: Date
}

/** Turns stored blocks into renderable ones (missing images or products drop out). */
export async function resolvePostBody(
  data: BlogPostData,
): Promise<ResolvedPostBlock[]> {
  const mediaIds = data.body.flatMap((b) =>
    b.type === "image" ? [b.mediaId] : [],
  )
  const productIds = data.body.flatMap((b) =>
    b.type === "products" ? b.productIds : [],
  )
  const [media, cards] = await Promise.all([
    loadMediaRefs(mediaIds),
    loadProductCards([...new Set(productIds)]),
  ])
  const byId = new Map(cards.map((card) => [card.id, card]))
  return data.body.flatMap((block): ResolvedPostBlock[] => {
    switch (block.type) {
      case "text":
        return [block]
      case "image": {
        const image = media.get(block.mediaId)
        return image
          ? [{ id: block.id, type: "image", image, caption: block.caption }]
          : []
      }
      case "products": {
        const products = block.productIds.flatMap((id) => {
          const card = byId.get(id)
          return card ? [card] : []
        })
        return products.length > 0
          ? [
              {
                id: block.id,
                type: "products",
                heading: block.heading,
                products,
              },
            ]
          : []
      }
      case "youtube":
      case "instagram":
        return [block]
    }
  })
}

/** A live post by address, with everything its page shows. */
export async function loadJournalPost(
  slug: string,
): Promise<JournalPost | null> {
  const found = await getDb().execute<
    CardRow & { data: unknown; updated_at: Date; author_id: string | null }
  >(sql`
    select ${CARD_COLUMNS}, r.data, r.published_at as updated_at, p.author_id
    from blog_posts p
    join cms_revisions r on r.id = p.published_revision_id
    left join blog_authors a on a.id = p.author_id
    left join blog_categories c on c.id = p.category_id
    where p.slug = ${slug} and p.status = 'published'`)
  const row = found.rows[0]
  if (!row) return null
  const data = blogPostDataSchema.parse(row.data)
  const [card] = await toCards([row])
  const [body, tags, author, og] = await Promise.all([
    resolvePostBody(data),
    getDb().execute<{ name: string; slug: string }>(sql`
      select t.name, t.slug::text from blog_post_tags pt join blog_tags t on t.id = pt.tag_id
      where pt.post_id = ${row.id} order by t.name`),
    row.author_id
      ? getDb().execute<{
          name: string
          slug: string
          bio: string | null
          photo_media_id: string | null
        }>(
          sql`select name, slug::text, bio, photo_media_id from blog_authors where id = ${row.author_id}`,
        )
      : Promise.resolve({ rows: [] }),
    data.seo.ogMediaId ? loadMediaRefs([data.seo.ogMediaId]) : null,
  ])
  const profile = author.rows[0]
  const photo = profile?.photo_media_id
    ? ((await loadMediaRefs([profile.photo_media_id])).get(
        profile.photo_media_id,
      ) ?? null)
    : null
  return {
    ...card!,
    body,
    tags: tags.rows,
    authorProfile: profile
      ? { name: profile.name, slug: profile.slug, bio: profile.bio, photo }
      : null,
    seo: data.seo,
    ogImage: data.seo.ogMediaId
      ? (og?.get(data.seo.ogMediaId) ?? card!.cover)
      : card!.cover,
    updatedAt: new Date(row.updated_at),
  }
}

/** Up to three other live posts, same category first. */
export async function loadRelatedPosts(post: {
  id: string
  category: { slug: string } | null
}): Promise<JournalCard[]> {
  const result = await getDb().execute<CardRow>(sql`
    select ${CARD_COLUMNS}
    from blog_posts p
    left join blog_authors a on a.id = p.author_id
    left join blog_categories c on c.id = p.category_id
    where p.status = 'published' and p.id <> ${post.id}
    order by (c.slug = ${post.category?.slug ?? ""}) desc nulls last, p.published_at desc
    limit 3`)
  return toCards(result.rows)
}

/** Live posts for the RSS feed and the sitemap. */
export async function loadJournalFeed(limit = 30): Promise<JournalCard[]> {
  const result = await getDb().execute<CardRow>(sql`
    select ${CARD_COLUMNS}
    from blog_posts p
    left join blog_authors a on a.id = p.author_id
    left join blog_categories c on c.id = p.category_id
    where p.status = 'published'
      and not coalesce((select (r.data->'seo'->>'noindex')::boolean from cms_revisions r
                        where r.id = p.published_revision_id), false)
    order by p.published_at desc
    limit ${limit}`)
  return toCards(result.rows)
}
