import pg from "pg"

import { isRedirectable, normalizePath } from "@/features/redirects/paths"

/**
 * The redirect table as the request proxy sees it (doc/06 Phase 6b). The
 * proxy keeps its own copy in memory, reloaded every 30 seconds, so a
 * request costs no database query. If the database is unreachable the last
 * copy keeps working and pages are never held up.
 */

const RELOAD_MS = 30_000

type Target = { to: string; status: 301 | 302 }

let pool: pg.Pool | null = null
let table = new Map<string, Target>()
let loadedAt = 0
let loading: Promise<void> | null = null

function db(): pg.Pool {
  pool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    idleTimeoutMillis: 60_000,
    application_name: "duis-proxy-redirects",
  })
  return pool
}

async function reload(): Promise<void> {
  try {
    const result = await db().query<{
      from_path: string
      to_path: string
      status_code: number
    }>("select from_path, to_path, status_code from redirects")
    table = new Map(
      result.rows.map((row) => [
        row.from_path,
        { to: row.to_path, status: row.status_code === 302 ? 302 : 301 },
      ]),
    )
  } catch {
    // Keep serving the last known table.
  } finally {
    loadedAt = Date.now()
    loading = null
  }
}

/** Where `pathname` should go, if anywhere. */
export async function findRedirect(pathname: string): Promise<Target | null> {
  if (!isRedirectable(pathname)) return null
  if (Date.now() - loadedAt > RELOAD_MS) {
    loading ??= reload()
    // Only the very first load waits; later reloads happen in the background.
    if (loadedAt === 0) await loading
  }
  return table.get(normalizePath(pathname)) ?? null
}

/** Counts a hit after the response has gone (never blocks a visitor). */
export async function countHit(pathname: string): Promise<void> {
  try {
    await db().query(
      "update redirects set hits = hits + 1, last_hit_at = now() where from_path = $1",
      [normalizePath(pathname)],
    )
  } catch {
    // Hit counts are best-effort.
  }
}
