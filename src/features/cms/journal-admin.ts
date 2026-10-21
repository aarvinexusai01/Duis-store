import "server-only"
import { sql } from "drizzle-orm"
import { z } from "zod"

import { recordAddressChange, releaseAddress } from "@/features/redirects"
import { slugSchema } from "@/lib/slug-schema"
import type { Actor } from "@/server/auth/actor"
import { writeAudit } from "@/server/audit"
import { requestRevalidation } from "@/server/cache/revalidate"
import { cacheTags } from "@/server/cache/tags"
import { getDb } from "@/server/db/client"
import { withTransaction, type Transaction } from "@/server/db/transaction"
import { DomainError, isUniqueViolation } from "@/server/errors"
import { defineOperation } from "@/server/operation"

import { lockTarget, type Holder, type PageStatus } from "./content-target"
import type { BlogPostData } from "./journal-schemas"
import { insertRevision, postRefs } from "./service"
import { setStatus, type WorkflowStatus } from "./workflow"

/**
 * Journal admin (doc/06 Phase 6c): the post list, creating posts, post
 * addresses and going offline, and the authors, categories and tags.
 */

export const journalPath = {
  post: (slug: string) => `/journal/${slug}`,
  category: (slug: string) => `/journal/category/${slug}`,
  tag: (slug: string) => `/journal/tag/${slug}`,
  author: (slug: string) => `/journal/author/${slug}`,
}

const actorId = (actor: Actor) => (actor.kind === "user" ? actor.userId : null)

function slugTaken(error: unknown, what: string): never {
  if (isUniqueViolation(error))
    throw new DomainError("CONFLICT", `Another ${what} uses that address.`, {
      issues: { slug: [`Another ${what} uses that address.`] },
    })
  throw error
}

// --- Posts -----------------------------------------------------------------------------

export type AdminPostRow = {
  id: string
  slug: string
  title: string
  status: PageStatus
  draftStatus: WorkflowStatus | null
  unpublishedChanges: boolean
  scheduledFor: Date | null
  publishedAt: Date | null
  author: string | null
  updatedAt: Date
}

export const adminListPosts = defineOperation({
  name: "journal.adminListPosts",
  access: { cms: ["read"] },
  input: z.object({
    view: z.enum(["all", "review", "scheduled"]).default("all"),
  }),
  async handler(_ctx, { view }) {
    const rows = await getDb().execute<{
      id: string
      slug: string
      title: string
      draft_title: string | null
      status: PageStatus
      draft_status: WorkflowStatus | null
      changed: boolean
      scheduled_for: Date | null
      published_at: Date | null
      author: string | null
      updated_at: Date
    }>(sql`
      select p.id, p.slug::text, p.title, d.data->>'title' as draft_title, p.status,
             d.workflow_status as draft_status,
             (p.draft_revision_id is distinct from p.published_revision_id
               and d.workflow_status in ('draft', 'in_review', 'scheduled')) as changed,
             d.scheduled_for, p.published_at,
             (select a.name from blog_authors a
              where a.id = coalesce(p.author_id, (d.data->>'authorId')::uuid)) as author,
             greatest(p.updated_at, coalesce(d.updated_at, p.updated_at)) as updated_at
      from blog_posts p
      left join cms_revisions d on d.id = p.draft_revision_id
      where ${
        view === "review"
          ? sql`d.workflow_status = 'in_review' and p.status <> 'archived'`
          : view === "scheduled"
            ? sql`d.workflow_status = 'scheduled' and p.status <> 'archived'`
            : sql`true`
      }
      order by p.status = 'archived', coalesce(p.published_at, p.created_at) desc
      limit 200`)
    return rows.rows.map((r): AdminPostRow => ({
      id: r.id,
      slug: r.slug,
      title: r.draft_title || r.title,
      status: r.status,
      draftStatus: r.draft_status,
      unpublishedChanges: r.changed,
      scheduledFor: r.scheduled_for,
      publishedAt: r.published_at,
      author: r.author,
      updatedAt: r.updated_at,
    }))
  },
})

/** A new post: an empty first draft by the chosen author. */
export const createPost = defineOperation({
  name: "journal.createPost",
  access: { cms: ["draft"] },
  input: z.object({
    title: z.string().trim().min(1).max(140),
    slug: slugSchema,
    authorId: z.uuid(),
  }),
  async handler({ actor }, { title, slug, authorId }) {
    return withTransaction(async (tx) => {
      const author = await tx.execute(
        sql`select 1 from blog_authors where id = ${authorId}`,
      )
      if (!author.rows[0])
        throw new DomainError("NOT_FOUND", "Author not found.")
      const inserted = await tx
        .execute<{ id: string }>(
          sql`
          insert into blog_posts (slug, title, author_id, created_by)
          values (${slug}, ${title}, ${authorId}, ${actorId(actor)})
          returning id`,
        )
        .catch((error) => slugTaken(error, "post"))
      const id = inserted.rows[0]!.id
      const data: BlogPostData = {
        title,
        authorId,
        tagIds: [],
        body: [],
        seo: {},
      }
      const revision = await insertRevision(
        tx,
        "blog_post",
        id,
        data,
        postRefs(data),
        actorId(actor),
      )
      await tx.execute(
        sql`update blog_posts set draft_revision_id = ${revision.revisionId} where id = ${id}`,
      )
      await releaseAddress(tx, journalPath.post(slug))
      await writeAudit(tx, actor, {
        action: "cms.post.create",
        entityType: "blog_post",
        entityId: id,
        changes: { title, slug },
      })
      return { id }
    })
  },
})

async function lockPost(tx: Transaction, postId: string) {
  return (await lockTarget(tx, { type: "blog_post", id: postId })) as Holder & {
    post: NonNullable<Holder["post"]>
  }
}

/** A new address; a post that has been live keeps its old one working. */
export const changePostSlug = defineOperation({
  name: "journal.changePostSlug",
  access: { cms: ["publish"] },
  input: z.object({ postId: z.uuid(), slug: slugSchema }),
  async handler({ actor }, { postId, slug }) {
    return withTransaction(async (tx) => {
      const holder = await lockPost(tx, postId)
      const old = holder.post.slug
      if (old === slug) return { slug }
      await tx
        .execute(
          sql`update blog_posts set slug = ${slug}, updated_at = now() where id = ${postId}`,
        )
        .catch((error) => slugTaken(error, "post"))
      if (holder.post.publishedAt)
        await recordAddressChange(
          tx,
          journalPath.post(old),
          journalPath.post(slug),
        )
      else await releaseAddress(tx, journalPath.post(slug))
      await requestRevalidation(
        [
          cacheTags.journalPost(old),
          cacheTags.journalPost(slug),
          cacheTags.journalList,
        ],
        { tx },
      )
      await writeAudit(tx, actor, {
        action: "cms.post.change_slug",
        entityType: "blog_post",
        entityId: postId,
        changes: { from: old, to: slug },
      })
      return { slug }
    })
  },
})

async function takeOffline(
  tx: Transaction,
  actor: Actor,
  holder: Holder & { post: NonNullable<Holder["post"]> },
  status: "draft" | "archived",
) {
  if (holder.publishedRevisionId)
    await setStatus(tx, holder.publishedRevisionId, "archived")
  await tx.execute(sql`
    update cms_revisions set workflow_status = 'draft', scheduled_for = null, updated_at = now()
    where entity_type = 'blog_post' and entity_id = ${holder.entityId} and workflow_status = 'scheduled'`)
  await tx.execute(sql`
    update blog_posts set status = ${status}::publication_status, published_revision_id = null,
      updated_at = now()
    where id = ${holder.entityId}`)
  await requestRevalidation(
    [cacheTags.journalPost(holder.post.slug), cacheTags.journalList],
    { tx },
  )
  await writeAudit(tx, actor, {
    action: status === "archived" ? "cms.post.archive" : "cms.post.unpublish",
    entityType: "blog_post",
    entityId: holder.entityId,
    changes: { slug: holder.post.slug },
  })
}

export const unpublishPost = defineOperation({
  name: "journal.unpublishPost",
  access: { cms: ["publish"] },
  input: z.object({ postId: z.uuid() }),
  async handler({ actor }, { postId }) {
    return withTransaction(async (tx) => {
      const holder = await lockPost(tx, postId)
      if (holder.post.status !== "published")
        throw new DomainError("INVALID_STATE", "The post isn't live.")
      await takeOffline(tx, actor, holder, "draft")
      return {}
    })
  },
})

export const archivePost = defineOperation({
  name: "journal.archivePost",
  access: { cms: ["archive"] },
  input: z.object({ postId: z.uuid() }),
  async handler({ actor }, { postId }) {
    return withTransaction(async (tx) => {
      const holder = await lockPost(tx, postId)
      if (holder.post.status === "archived") return {}
      await takeOffline(tx, actor, holder, "archived")
      return {}
    })
  },
})

export const restorePost = defineOperation({
  name: "journal.restorePost",
  access: { cms: ["archive"] },
  input: z.object({ postId: z.uuid() }),
  async handler({ actor }, { postId }) {
    return withTransaction(async (tx) => {
      const holder = await lockPost(tx, postId)
      if (holder.post.status !== "archived") return {}
      await tx.execute(
        sql`update blog_posts set status = 'draft', updated_at = now() where id = ${postId}`,
      )
      await writeAudit(tx, actor, {
        action: "cms.post.restore",
        entityType: "blog_post",
        entityId: postId,
      })
      return {}
    })
  },
})

// --- Authors, categories and tags ------------------------------------------------------

export type JournalTaxonomy = {
  authors: {
    id: string
    slug: string
    name: string
    bio: string | null
    photoMediaId: string | null
    photoKey: string | null
    posts: number
  }[]
  categories: {
    id: string
    slug: string
    name: string
    description: string | null
    posts: number
  }[]
  tags: { id: string; slug: string; name: string; posts: number }[]
}

/** Counts include drafts, so nothing in use is ever deleted. */
export const getJournalTaxonomy = defineOperation({
  name: "journal.taxonomy",
  access: { cms: ["read"] },
  input: z.object({}),
  async handler(): Promise<JournalTaxonomy> {
    const db = getDb()
    const [authors, categories, tags] = await Promise.all([
      db.execute<
        JournalTaxonomy["authors"][number] & {
          photo_media_id: string | null
          photo_key: string | null
        }
      >(sql`
        select a.id, a.slug::text, a.name, a.bio, a.photo_media_id, m.storage_key as photo_key,
          (select count(*)::int from blog_posts p left join cms_revisions d on d.id = p.draft_revision_id
           where p.author_id = a.id or d.data->>'authorId' = a.id::text) as posts
        from blog_authors a left join media_assets m on m.id = a.photo_media_id
        order by a.name`),
      db.execute<JournalTaxonomy["categories"][number]>(sql`
        select c.id, c.slug::text, c.name, c.description,
          (select count(*)::int from blog_posts p left join cms_revisions d on d.id = p.draft_revision_id
           where p.category_id = c.id or d.data->>'categoryId' = c.id::text) as posts
        from blog_categories c order by c.position, c.name`),
      db.execute<JournalTaxonomy["tags"][number]>(sql`
        select t.id, t.slug::text, t.name,
          (select count(*)::int from blog_posts p left join cms_revisions d on d.id = p.draft_revision_id
           where exists (select 1 from blog_post_tags pt where pt.post_id = p.id and pt.tag_id = t.id)
              or d.data->'tagIds' ? t.id::text) as posts
        from blog_tags t order by t.name`),
    ])
    return {
      authors: authors.rows.map((a) => ({
        id: a.id,
        slug: a.slug,
        name: a.name,
        bio: a.bio,
        photoMediaId: a.photo_media_id,
        photoKey: a.photo_key,
        posts: a.posts,
      })),
      categories: categories.rows,
      tags: tags.rows,
    }
  },
})

const authorFields = z.object({
  name: z.string().trim().min(1).max(80),
  slug: slugSchema,
  bio: z.string().trim().max(500).nullish(),
  photoMediaId: z.uuid().nullish(),
})

export const saveAuthor = defineOperation({
  name: "journal.saveAuthor",
  access: { cms: ["publish"] },
  input: authorFields.extend({ id: z.uuid().optional() }),
  async handler({ actor }, { id, name, slug, bio, photoMediaId }) {
    return withTransaction(async (tx) => {
      let authorId = id
      if (id) {
        const old = await tx.execute<{ slug: string }>(
          sql`select slug::text from blog_authors where id = ${id} for update`,
        )
        if (!old.rows[0])
          throw new DomainError("NOT_FOUND", "Author not found.")
        await tx
          .execute(
            sql`
            update blog_authors set name = ${name}, slug = ${slug}, bio = ${bio ?? null},
              photo_media_id = ${photoMediaId ?? null}, updated_at = now()
            where id = ${id}`,
          )
          .catch((error) => slugTaken(error, "author"))
        if (old.rows[0].slug !== slug)
          await recordAddressChange(
            tx,
            journalPath.author(old.rows[0].slug),
            journalPath.author(slug),
          )
      } else {
        const inserted = await tx
          .execute<{ id: string }>(
            sql`
            insert into blog_authors (name, slug, bio, photo_media_id)
            values (${name}, ${slug}, ${bio ?? null}, ${photoMediaId ?? null}) returning id`,
          )
          .catch((error) => slugTaken(error, "author"))
        authorId = inserted.rows[0]!.id
        await releaseAddress(tx, journalPath.author(slug))
      }
      await requestRevalidation([cacheTags.journalList], { tx })
      await writeAudit(tx, actor, {
        action: id ? "journal.author.update" : "journal.author.create",
        entityType: "blog_author",
        entityId: authorId!,
        changes: { name, slug },
      })
      return { id: authorId! }
    })
  },
})

export const saveCategory = defineOperation({
  name: "journal.saveCategory",
  access: { cms: ["publish"] },
  input: z.object({
    id: z.uuid().optional(),
    name: z.string().trim().min(1).max(60),
    slug: slugSchema,
    description: z.string().trim().max(300).nullish(),
  }),
  async handler({ actor }, { id, name, slug, description }) {
    return withTransaction(async (tx) => {
      let categoryId = id
      if (id) {
        const old = await tx.execute<{ slug: string }>(
          sql`select slug::text from blog_categories where id = ${id} for update`,
        )
        if (!old.rows[0])
          throw new DomainError("NOT_FOUND", "Category not found.")
        await tx
          .execute(
            sql`
            update blog_categories set name = ${name}, slug = ${slug},
              description = ${description ?? null}, updated_at = now()
            where id = ${id}`,
          )
          .catch((error) => slugTaken(error, "category"))
        if (old.rows[0].slug !== slug)
          await recordAddressChange(
            tx,
            journalPath.category(old.rows[0].slug),
            journalPath.category(slug),
          )
      } else {
        const inserted = await tx
          .execute<{ id: string }>(
            sql`
            insert into blog_categories (name, slug, description, position)
            values (${name}, ${slug}, ${description ?? null},
              (select coalesce(max(position), 0) + 1 from blog_categories))
            returning id`,
          )
          .catch((error) => slugTaken(error, "category"))
        categoryId = inserted.rows[0]!.id
        await releaseAddress(tx, journalPath.category(slug))
      }
      await requestRevalidation([cacheTags.journalList], { tx })
      await writeAudit(tx, actor, {
        action: id ? "journal.category.update" : "journal.category.create",
        entityType: "blog_category",
        entityId: categoryId!,
        changes: { name, slug },
      })
      return { id: categoryId! }
    })
  },
})

/** Editors add tags while writing; the address comes from the name. */
export const createTag = defineOperation({
  name: "journal.createTag",
  access: { cms: ["draft"] },
  input: z.object({
    name: z.string().trim().min(1).max(40),
    slug: slugSchema,
  }),
  async handler({ actor }, { name, slug }) {
    return withTransaction(async (tx) => {
      const existing = await tx.execute<{ id: string; name: string }>(
        sql`select id, name from blog_tags where slug = ${slug}`,
      )
      if (existing.rows[0]) return existing.rows[0]
      const inserted = await tx.execute<{ id: string }>(sql`
        insert into blog_tags (name, slug) values (${name}, ${slug}) returning id`)
      const id = inserted.rows[0]!.id
      await writeAudit(tx, actor, {
        action: "journal.tag.create",
        entityType: "blog_tag",
        entityId: id,
        changes: { name, slug },
      })
      return { id, name }
    })
  },
})

/** Authors, categories and tags can go only when no post (draft or live) uses them. */
export const deleteJournalTerm = defineOperation({
  name: "journal.deleteTerm",
  access: { cms: ["publish"] },
  input: z.object({
    kind: z.enum(["author", "category", "tag"]),
    id: z.uuid(),
  }),
  async handler({ actor }, { kind, id }) {
    return withTransaction(async (tx) => {
      const used = await tx.execute<{ title: string }>(
        kind === "author"
          ? sql`
            select coalesce(d.data->>'title', p.title) as title from blog_posts p
            left join cms_revisions d on d.id = p.draft_revision_id
            where p.author_id = ${id} or d.data->>'authorId' = ${id} limit 3`
          : kind === "category"
            ? sql`
            select coalesce(d.data->>'title', p.title) as title from blog_posts p
            left join cms_revisions d on d.id = p.draft_revision_id
            where p.category_id = ${id} or d.data->>'categoryId' = ${id} limit 3`
            : sql`
            select coalesce(d.data->>'title', p.title) as title from blog_posts p
            left join cms_revisions d on d.id = p.draft_revision_id
            where exists (select 1 from blog_post_tags pt where pt.post_id = p.id and pt.tag_id = ${id})
               or d.data->'tagIds' ? ${id} limit 3`,
      )
      if (used.rows.length > 0) {
        const names = used.rows.map((r) => `"${r.title}"`).join(", ")
        throw new DomainError(
          "CONFLICT",
          `Still used by ${names}. Change those posts first.`,
        )
      }
      const table =
        kind === "author"
          ? sql`blog_authors`
          : kind === "category"
            ? sql`blog_categories`
            : sql`blog_tags`
      const removed = await tx.execute(
        sql`delete from ${table} where id = ${id} returning id`,
      )
      if (!removed.rows[0]) throw new DomainError("NOT_FOUND", "Not found.")
      await requestRevalidation([cacheTags.journalList], { tx })
      await writeAudit(tx, actor, {
        action: `journal.${kind}.delete`,
        entityType: `blog_${kind}`,
        entityId: id,
      })
      return {}
    })
  },
})
