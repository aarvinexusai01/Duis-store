import { sql } from "drizzle-orm"

/**
 * Array parameters for raw SQL. Drizzle expands an inline JS array into a
 * parameter list `($1, $2)`; these bind it as one Postgres array instead.
 */
export const uuidArray = (values: readonly string[]) =>
  sql`${sql.param([...values])}::uuid[]`

export const textArray = (values: readonly string[]) =>
  sql`${sql.param([...values])}::text[]`
