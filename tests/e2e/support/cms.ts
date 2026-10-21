import pg from "pg"

/**
 * Deletes a page a CMS spec created (by slug, or every slug starting with a
 * prefix ending in "-"), so repeated runs don't fill the page list.
 */
export async function removeTestPages(slugOrPrefix: string) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    await client.query("begin")
    const pattern = slugOrPrefix.endsWith("-")
      ? `${slugOrPrefix}%`
      : slugOrPrefix
    await client.query(
      `update cms_pages set draft_revision_id = null, published_revision_id = null where slug::text like $1`,
      [pattern],
    )
    await client.query(
      `delete from cms_revisions where entity_type = 'page'
         and entity_id in (select id from cms_pages where slug::text like $1)`,
      [pattern],
    )
    // Redirects to or from the test page's addresses.
    await client.query(
      `delete from redirects where from_path like '/pages/' || $1 or to_path like '/pages/' || $1`,
      [pattern],
    )
    await client.query(`delete from cms_pages where slug::text like $1`, [
      pattern,
    ])
    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    await client.end()
  }
}

/** Deletes a test story (and redirects to or from it) and, optionally, its author. */
export async function removeTestStory(slug: string, authorSlug?: string) {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    await client.query("begin")
    await client.query(
      `update blog_posts set draft_revision_id = null, published_revision_id = null where slug::text = $1`,
      [slug],
    )
    await client.query(
      `delete from cms_revisions where entity_type = 'blog_post'
         and entity_id in (select id from blog_posts where slug::text = $1)`,
      [slug],
    )
    await client.query(
      `delete from redirects where from_path = $1 or to_path = $1`,
      [`/journal/${slug}`],
    )
    await client.query(`delete from blog_posts where slug::text = $1`, [slug])
    if (authorSlug)
      await client.query(`delete from blog_authors where slug::text = $1`, [
        authorSlug,
      ])
    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    await client.end()
  }
}
