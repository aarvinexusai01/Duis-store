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
