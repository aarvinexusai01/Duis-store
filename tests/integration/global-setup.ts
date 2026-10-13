import { Client } from "pg"

/** Fails fast with a clear message when the local database is not running. */
export default async function setup(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env (see README.md).",
    )
  }

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5_000,
  })
  try {
    await client.connect()
    await client.query("select 1")
  } catch (err) {
    throw new Error(
      `Cannot reach PostgreSQL at DATABASE_URL — start it with "npm run db:up". (${(err as Error).message})`,
    )
  } finally {
    await client.end().catch(() => {})
  }
}
