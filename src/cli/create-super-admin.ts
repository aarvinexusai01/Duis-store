import { randomBytes } from "node:crypto"
import { parseArgs } from "node:util"

import { eq } from "drizzle-orm"
import { z } from "zod"

import { users } from "@/db/schema"
import { systemActor } from "@/server/auth/actor"
import { getAuth } from "@/server/auth/auth"
import { writeAudit } from "@/server/audit"
import { closeDb, getDb } from "@/server/db/client"
import { stopSender } from "@/server/jobs/enqueue"

/**
 * Bootstraps the first super admin (doc/06 Phase 1):
 *   npm run admin:create -- --email owner@example.com --name "Store Owner"
 *   docker compose run --rm web_a node dist/create-super-admin.mjs --email … --name …
 * The password comes from ADMIN_PASSWORD, or a strong one is generated and
 * printed once. Two-factor enrolment is required at first sign-in.
 */
async function main() {
  const { values } = parseArgs({
    options: { email: { type: "string" }, name: { type: "string" } },
  })
  const args = z
    .object({ email: z.email(), name: z.string().trim().min(2).max(100) })
    .parse({ email: values.email, name: values.name })

  const generated = !process.env.ADMIN_PASSWORD
  const password =
    process.env.ADMIN_PASSWORD ?? randomBytes(18).toString("base64url")
  if (password.length < 12)
    throw new Error("ADMIN_PASSWORD must be at least 12 characters.")

  const [existing] = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, args.email))
  if (existing) throw new Error(`A user with ${args.email} already exists.`)

  const { user } = await getAuth().api.signUpEmail({
    body: { email: args.email, password, name: args.name },
  })
  await getDb()
    .update(users)
    .set({ role: "super_admin", emailVerified: true })
    .where(eq(users.id, user.id))
  await writeAudit(getDb(), systemActor("cli.create-super-admin"), {
    action: "staff.create_super_admin",
    entityType: "user",
    entityId: user.id,
    changes: { email: args.email },
  })

  console.log(`\nSuper admin created: ${args.email}`)
  if (generated) console.log(`Password (shown once, store it now): ${password}`)
  console.log("Two-factor authentication must be set up at first sign-in.\n")
}

main()
  .catch((err: unknown) => {
    console.error((err as Error).message)
    process.exitCode = 1
  })
  .finally(async () => {
    await stopSender()
    await closeDb()
  })
