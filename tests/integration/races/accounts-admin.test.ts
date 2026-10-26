import { createHash, randomBytes } from "node:crypto"

import { sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { sendBackInStock, subscribeStockAlert } from "@/features/alerts"
import { updateProduct } from "@/features/catalog"
import { createPage } from "@/features/cms"
import { autosaveDraft, publishDraft } from "@/features/cms/workflow"
import { adjustStock } from "@/features/inventory"
import { acceptInvitation, inviteStaff } from "@/features/staff"
import { anonymousActor, type Actor } from "@/server/auth/actor"
import { getAuth } from "@/server/auth/auth"
import { getDb } from "@/server/db/client"
import { lastFakeOtp } from "@/server/notifications/sms"

import { asSystem, createUserActor, unique } from "../../helpers/actors"
import { closeConnectionsAfterAll } from "../../helpers/cleanup"
import {
  count,
  expectInvariants,
  race,
  RUNS,
  stockOf,
  variantWithStock,
  raceProduct,
} from "./support"

closeConnectionsAfterAll()
afterAll(expectInvariants)

const runs = Array.from({ length: RUNS }, (_, i) => i + 1)
const db = () => getDb()

let superAdmin: Actor
let catalogA: Actor
let catalogB: Actor
let manager: Actor
beforeAll(async () => {
  superAdmin = await createUserActor("super_admin")
  catalogA = await createUserActor("store_admin")
  catalogB = await createUserActor("store_admin")
  manager = await createUserActor("content_manager")
})

/** Better Auth answers with a Response; anything but a 5xx is a clean answer. */
async function status(work: Promise<Response>): Promise<number> {
  try {
    return (await work).status
  } catch (error) {
    return (error as { statusCode?: number }).statusCode ?? 500
  }
}

describe("A1–A2: signing in and up at the same moment", () => {
  it.each(runs)(
    "A1: the same OTP submitted twice at once signs in once (run %i)",
    async () => {
      const auth = getAuth()
      const phoneNumber = `+9196${String(Math.random()).slice(2, 10)}`
      await auth.api.sendPhoneNumberOTP({ body: { phoneNumber } })
      const code = lastFakeOtp(phoneNumber)!
      const verify = () =>
        auth.api.verifyPhoneNumber({
          body: { phoneNumber, code },
          asResponse: true,
        })
      const statuses = await Promise.all([status(verify()), status(verify())])
      expect(statuses.filter((s) => s === 200)).toHaveLength(1)
      expect(statuses.every((s) => s < 500)).toBe(true)
      const sessions = await db().execute<{
        users: number
        sessions: number
      }>(sql`
        select count(distinct u.id)::int as users, count(s.id)::int as sessions
        from users u left join sessions s on s.user_id = u.id
        where u.phone_number = ${phoneNumber}`)
      expect(sessions.rows[0]).toEqual({ users: 1, sessions: 1 })
    },
  )

  it.each(runs)(
    "A2: two sign-ups with one email at once make one account (run %i)",
    async () => {
      const auth = getAuth()
      const email = `${unique("twin")}@duis.test`
      const signUp = () =>
        auth.api.signUpEmail({
          body: { email, password: "correct-horse-battery-9", name: "Twin" },
          asResponse: true,
        })
      const statuses = await Promise.all([status(signUp()), status(signUp())])
      expect(statuses.filter((s) => s === 200)).toHaveLength(1)
      expect(statuses.every((s) => s < 500)).toBe(true)
      const accounts = await db().execute<{ n: number }>(
        sql`select count(*)::int as n from users where email = ${email}`,
      )
      expect(accounts.rows[0]!.n).toBe(1)
    },
  )
})

describe("A3–A5: staff working on the same thing", () => {
  async function productUpdatedAt(id: string): Promise<string> {
    const { rows } = await db().execute<{ updated_at: Date }>(
      sql`select updated_at from products where id = ${id}`,
    )
    return new Date(rows[0]!.updated_at).toISOString()
  }

  it.each(runs)(
    "A3: two staff save the same product: the second, stale save is refused (run %i)",
    async () => {
      const { productId } = await raceProduct()
      // Both opened the product before either saved.
      const opened = await productUpdatedAt(productId)
      const save = (actor: Actor, title: string) => () =>
        updateProduct(actor, {
          id: productId,
          title,
          expectedVersion: opened,
        })
      const outcomes = await race([
        save(catalogA, "Title from A"),
        save(catalogB, "Title from B"),
      ])
      expect(outcomes.toSorted()).toEqual(["CONFLICT", "ok"])
      const saved = await db().execute<{ title: string }>(
        sql`select title from products where id = ${productId}`,
      )
      expect(saved.rows[0]!.title).toBe(
        outcomes[0] === "ok" ? "Title from A" : "Title from B",
      )
      // Reloading gives a fresh token, and the next save goes through.
      await updateProduct(catalogA, {
        id: productId,
        title: "After reload",
        expectedVersion: await productUpdatedAt(productId),
      })
    },
  )

  it.each(runs)(
    "A4: two managers publish the same draft at once: one revision goes live (run %i)",
    async () => {
      const { id } = await createPage(manager, {
        type: "landing",
        slug: unique("race"),
        title: "Race",
      })
      const target = { type: "page" as const, id }
      await autosaveDraft(manager, {
        target,
        data: {
          sections: [
            { id: "a", type: "announcement", enabled: true, text: "Live" },
          ],
          seo: {},
        },
        base: null,
      })
      const other = await createUserActor("content_manager")
      const outcomes = await race([
        () => publishDraft(manager, { target }),
        () => publishDraft(other, { target }),
      ])
      expect(count(outcomes, "ok")).toBeGreaterThanOrEqual(1)
      expect(
        outcomes.filter(
          (o) => !["ok", "CONFLICT", "INVALID_STATE"].includes(o),
        ),
      ).toEqual([])
      const published = await db().execute<{ n: number }>(sql`
        select count(*)::int as n from cms_revisions where entity_type = 'page' and entity_id = ${id} and workflow_status = 'published'`)
      expect(published.rows[0]!.n).toBe(1)
      // Both managers wanted this draft live: it goes live, and is recorded, once.
      const audits = await db().execute<{ n: number }>(sql`
        select count(*)::int as n from audit_logs where action = 'cms.publish' and entity_id = ${id}`)
      expect(audits.rows[0]!.n).toBe(1)
    },
  )

  it.each(runs)(
    "A5: two staff adjust the same stock at once: both changes apply (run %i)",
    async () => {
      const variantId = await variantWithStock(10)
      const outcomes = await race([
        () => adjustStock(catalogA, { variantId, delta: 5, reason: "receive" }),
        () =>
          adjustStock(catalogB, { variantId, delta: -3, reason: "damaged" }),
      ])
      expect(outcomes).toEqual(["ok", "ok"])
      expect(await stockOf(variantId)).toEqual({ on_hand: 12, reserved: 0 })
    },
  )
})

describe("A6–A7: links and alerts used twice", () => {
  it.each(runs)(
    "A6: a staff invitation accepted twice at once makes one account (run %i)",
    async () => {
      const email = `${unique("invite")}@duis.test`
      await inviteStaff(superAdmin, { email, roles: ["support_agent"] })
      const token = randomBytes(32).toString("base64url")
      await db().execute(sql`
        update staff_invitations set token_hash = ${createHash("sha256").update(token).digest("hex")}
        where email = ${email} and accepted_at is null and revoked_at is null`)
      const accept = () =>
        acceptInvitation(anonymousActor(), {
          token,
          name: "New Support",
          password: "Support-Passw0rd!",
        })
      const outcomes = await race([accept, accept])
      expect(outcomes.toSorted()).toEqual(["INVALID_STATE", "ok"])
      const users = await db().execute<{ n: number }>(
        sql`select count(*)::int as n from users where email = ${email}`,
      )
      expect(users.rows[0]!.n).toBe(1)
    },
  )

  it.each(runs)(
    "A7: two restocks at once email each waiting customer once (run %i)",
    async () => {
      const variantId = await variantWithStock(0)
      const emails = Array.from(
        { length: 3 },
        () => `${unique("waiting")}@duis.test`,
      )
      for (const email of emails) {
        expect(
          await subscribeStockAlert(anonymousActor(), { variantId, email }),
        ).toEqual({ status: "subscribed" })
      }
      await race([
        () =>
          adjustStock(asSystem(), { variantId, delta: 2, reason: "receive" }),
        () =>
          adjustStock(asSystem(), { variantId, delta: 3, reason: "receive" }),
      ])
      // The worker may pick up both restock jobs at once.
      const sends = await race([
        () => sendBackInStock(variantId),
        () => sendBackInStock(variantId),
      ])
      expect(sends).toEqual(["ok", "ok"])
      const sent = await db().execute<{ n: number }>(sql`
        select count(*)::int as n from notification_logs
        where template = 'back-in-stock' and reference_id in (
          select id::text from stock_alerts where variant_id = ${variantId})`)
      expect(sent.rows[0]!.n).toBe(3)
    },
  )
})
