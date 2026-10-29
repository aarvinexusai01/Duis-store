import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { Client, Pool } from "pg"
import { PgBoss } from "pg-boss"
import { createClient } from "redis"
import { Client as SearchClient } from "@elastic/elasticsearch"

import { ensureQueues } from "@/server/jobs/queues"

/**
 * Builds a throwaway database for every run — proving the migrations apply to
 * an empty database — and points the test workers at it:
 * 1. drop and recreate TEST_DATABASE_NAME as the superuser;
 * 2. apply docker/postgres/initdb/02-database.sql (roles, schemas, extensions);
 * 3. run every migration as duis_owner;
 * 4. install pg-boss and the queues as duis_app;
 * 5. empty the tests' own Redis database (never the dev server's);
 * 6. delete the tests' own search indexes (search.test.ts builds them).
 */
function withDatabase(url: string, database: string): string {
  const parsed = new URL(url)
  parsed.pathname = `/${database}`
  return parsed.toString()
}

function required(name: string): string {
  const value = process.env[name]
  if (!value)
    throw new Error(
      `${name} is not set. Copy .env.example to .env (see README.md).`,
    )
  return value
}

export default async function setup() {
  const adminUrl = required("TEST_ADMIN_DATABASE_URL")
  const database = process.env.TEST_DATABASE_NAME ?? "duis_test"
  if (!/^[a-z_][a-z0-9_]*_test$/.test(database)) {
    throw new Error(
      "TEST_DATABASE_NAME must end in _test — it is dropped on every run.",
    )
  }

  const admin = new Client({
    connectionString: adminUrl,
    connectionTimeoutMillis: 5_000,
  })
  try {
    await admin.connect()
  } catch (err) {
    throw new Error(
      `Cannot reach PostgreSQL — start it with "npm run db:up". (${(err as Error).message})`,
    )
  }
  await admin.query(`drop database if exists "${database}" with (force)`)
  await admin.query(`create database "${database}"`)
  await admin.end()

  const setupSql = await readFile(
    path.resolve("docker/postgres/initdb/02-database.sql"),
    "utf8",
  )
  const testAdmin = new Client({
    connectionString: withDatabase(adminUrl, database),
  })
  await testAdmin.connect()
  await testAdmin.query(setupSql)
  await testAdmin.end()

  const ownerUrl = withDatabase(required("MIGRATION_DATABASE_URL"), database)
  const ownerPool = new Pool({ connectionString: ownerUrl, max: 1 })
  await migrate(drizzle({ client: ownerPool }), {
    migrationsFolder: path.resolve("src/db/migrations"),
    migrationsSchema: "drizzle",
    migrationsTable: "__drizzle_migrations",
  })
  await ownerPool.end()

  const appUrl = withDatabase(required("DATABASE_URL"), database)
  const boss = new PgBoss({
    connectionString: appUrl,
    schema: "pgboss",
    createSchema: false,
  })
  await boss.start()
  await ensureQueues(boss)
  await boss.stop({ graceful: false })

  const redisUrl =
    process.env.TEST_REDIS_URL ?? "redis://:redis_dev_only@localhost:6380/15"
  const redis = createClient({
    url: redisUrl,
    socket: { connectTimeout: 3_000, reconnectStrategy: false },
  })
  try {
    await redis.connect()
  } catch (err) {
    throw new Error(
      `Cannot reach Redis — start it with "npm run db:up". (${(err as Error).message})`,
    )
  }
  await redis.flushDb()
  await redis.close()

  const searchUrl =
    process.env.TEST_ELASTICSEARCH_URL ?? "http://localhost:9200"
  const searchPassword =
    process.env.TEST_ELASTICSEARCH_PASSWORD ?? "elastic_dev_only"
  const searchIndex =
    process.env.TEST_ELASTICSEARCH_INDEX ?? "duis-products-test"
  if (!searchIndex.endsWith("-test")) {
    throw new Error("TEST_ELASTICSEARCH_INDEX must end in -test.")
  }
  const search = new SearchClient({
    node: searchUrl,
    auth: { username: "elastic", password: searchPassword },
    requestTimeout: 10_000,
  })
  try {
    // Elasticsearch refuses wildcard deletes, so name each index.
    const old = Object.keys(
      await search.indices.get({ index: `${searchIndex}-v*` }),
    )
    if (old.length > 0) await search.indices.delete({ index: old })
  } catch (err) {
    throw new Error(
      `Cannot reach Elasticsearch — start it with "npm run db:up". (${(err as Error).message})`,
    )
  } finally {
    await search.close()
  }

  const mediaRoot = await mkdtemp(path.join(tmpdir(), "duis-test-media-"))

  // Inherited by the test workers, which start after this function returns.
  process.env.DATABASE_URL = appUrl
  process.env.MIGRATION_DATABASE_URL = ownerUrl
  process.env.REDIS_URL = redisUrl
  process.env.ELASTICSEARCH_URL = searchUrl
  process.env.ELASTICSEARCH_USERNAME = "elastic"
  process.env.ELASTICSEARCH_PASSWORD = searchPassword
  process.env.ELASTICSEARCH_INDEX = searchIndex
  // A busy test run must not trip the fallback to Postgres by accident.
  process.env.ELASTICSEARCH_TIMEOUT_MS = "15000"
  process.env.APP_ENV = "test"
  // Tests never reach real providers, whatever the developer's .env says.
  process.env.PAYMENT_PROVIDER = "fake"
  process.env.SHIPPING_PROVIDER = "fake"
  process.env.SMS_PROVIDER = "fake"
  process.env.MEDIA_ROOT = mediaRoot
  process.env.LOG_LEVEL ??= "warn"

  return async () => {
    await rm(mediaRoot, { recursive: true, force: true })
  }
}
