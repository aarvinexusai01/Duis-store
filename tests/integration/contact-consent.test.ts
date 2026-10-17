import { createHash } from "node:crypto"

import { sql } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"

import {
  buildMetaPurchase,
  purchaseEventId,
  recordConsent,
} from "@/features/analytics"
import {
  adminGetMessage,
  adminListMessages,
  sendContactMessage,
  updateContactMessage,
} from "@/features/contact"
import { updateNotificationSettings } from "@/features/settings"
import { anonymousActor, type Actor } from "@/server/auth/actor"
import { getDb, getPool } from "@/server/db/client"

import { actorWithRole, createUserActor } from "../helpers/actors"
import { closeConnectionsAfterAll } from "../helpers/cleanup"
import { buyer, code, paidOrder, sellableProduct } from "../helpers/shop"

closeConnectionsAfterAll()

const db = () => getDb()
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex")

const message = (email: string) => ({
  name: "Asha",
  email,
  phone: "",
  orderNumber: "duis-999999",
  topic: "product" as const,
  message: "Does the oversized tee run large? I'm usually a medium.",
})

describe("contact form", () => {
  let admin: Actor

  beforeAll(async () => {
    admin = await createUserActor("store_admin")
    await updateNotificationSettings(admin, {
      emailSenderName: "Duis",
      emailReplyTo: "hello@duis.test",
      supportEmail: "support@duis.test",
      notifyOrderShipped: true,
      notifyPaymentReminder: true,
      notifyLowStock: true,
    })
  })

  it("saves the message and emails the team with reply-to the customer", async () => {
    const email = `asha-${Date.now()}@duis.test`
    const { id } = await sendContactMessage(anonymousActor(), message(email))
    const job = await db().execute<{
      to: string
      reply_to: string
      url: string
    }>(sql`
      select data->>'to' as to, data->>'replyTo' as reply_to, data->'props'->>'url' as url
      from pgboss.job where name = 'notify.email' and data->>'template' = 'contact-message'
        and data->>'replyTo' = ${email}`)
    expect(job.rows).toEqual([
      {
        to: "support@duis.test",
        reply_to: email,
        url: expect.stringMatching(new RegExp(`/admin/messages/${id}$`)),
      },
    ])
    const saved = await adminGetMessage(admin, { id })
    expect(saved).toMatchObject({
      email,
      phone: null,
      orderNumber: "DUIS-999999",
      orderExists: false,
      status: "new",
    })
  })

  it("rejects bad input and limits messages per address", async () => {
    expect(
      await code(
        sendContactMessage(anonymousActor(), {
          ...message("x@duis.test"),
          message: "hi",
        }),
      ),
    ).toBe("VALIDATION_FAILED")
    const email = `busy-${Date.now()}@duis.test`
    for (let i = 0; i < 5; i += 1) {
      await sendContactMessage(anonymousActor(), message(email))
    }
    expect(
      await code(sendContactMessage(anonymousActor(), message(email))),
    ).toBe("RATE_LIMITED")
  })

  it("lets support staff work the inbox, audited", async () => {
    const email = `inbox-${Date.now()}@duis.test`
    const { id } = await sendContactMessage(anonymousActor(), message(email))
    const agent = await createUserActor("support_agent")
    const open = await adminListMessages(agent, { status: "new", q: email })
    expect(open.rows.map((m) => m.id)).toEqual([id])

    await updateContactMessage(agent, {
      id,
      status: "replied",
      note: "Sent the size chart.",
    })
    const replied = await adminGetMessage(agent, { id })
    expect(replied).toMatchObject({
      status: "replied",
      note: "Sent the size chart.",
      handledBy: "Test support_agent",
    })
    expect(
      (await adminListMessages(agent, { status: "new", q: email })).rows,
    ).toEqual([])

    // An empty note clears it; reopening forgets who handled it.
    await updateContactMessage(agent, { id, status: "new", note: "" })
    expect(await adminGetMessage(agent, { id })).toMatchObject({
      status: "new",
      note: null,
      handledBy: null,
    })
    const audit = await db().execute<{ action: string }>(sql`
      select action from audit_logs where entity_type = 'contact_message' and entity_id = ${id}`)
    expect(audit.rows).toHaveLength(2)

    expect(
      await code(adminListMessages(actorWithRole("content_editor"), {})),
    ).toBe("FORBIDDEN")
    expect(
      await code(
        updateContactMessage(actorWithRole("fulfilment_staff"), {
          id,
          status: "closed",
        }),
      ),
    ).toBe("FORBIDDEN")
  })
})

describe("cookie consent records", () => {
  it("appends each answer and can't be rewritten", async () => {
    const visitorId = crypto.randomUUID()
    await recordConsent(anonymousActor(), {
      visitorId,
      analytics: true,
      marketing: false,
      source: "banner",
    })
    await recordConsent(anonymousActor(), {
      visitorId,
      analytics: false,
      marketing: false,
      source: "settings",
    })
    const rows = await db().execute<{ analytics: boolean; source: string }>(
      sql`select analytics, source from consent_records where visitor_id = ${visitorId} order by created_at`,
    )
    expect(rows.rows).toEqual([
      { analytics: true, source: "banner" },
      { analytics: false, source: "settings" },
    ])
    await expect(
      getPool().query("update consent_records set analytics = true"),
    ).rejects.toThrow(/permission denied/)
    await expect(
      getPool().query("delete from consent_records"),
    ).rejects.toThrow(/permission denied/)
  })
})

describe("Meta Conversions API purchase", () => {
  let variantId: string
  beforeAll(async () => {
    ;({ variantId } = await sellableProduct())
  })

  async function orderId(orderNumber: string) {
    const found = await db().execute<{ id: string }>(
      sql`select id from orders where order_number = ${orderNumber}`,
    )
    return found.rows[0]!.id
  }

  it("is built only for buyers who gave marketing consent", async () => {
    const customer = await buyer()
    const without = await paidOrder(customer, variantId)
    expect(await buildMetaPurchase(await orderId(without))).toBeNull()

    const fbp = "fb.1.1700000000000.1234567890"
    const orderNumber = await paidOrder(customer, variantId, {
      quantity: 2,
      marketingContext: { fbp, userAgent: "Mozilla/5.0 test" },
    })
    const event = await buildMetaPurchase(await orderId(orderNumber))
    const user = await db().execute<{ email: string }>(
      sql`select email from users where id = ${customer.userId}`,
    )
    expect(event).toMatchObject({
      event_name: "Purchase",
      event_id: purchaseEventId(orderNumber),
      action_source: "website",
      user_data: {
        em: [sha256(user.rows[0]!.email.toLowerCase())],
        ph: [sha256("919876543210")],
        external_id: [sha256(customer.userId)],
        ct: [sha256("lucknow")],
        st: [sha256("up")],
        zp: [sha256("226001")],
        country: [sha256("in")],
        fbp,
        client_user_agent: "Mozilla/5.0 test",
      },
      custom_data: { currency: "INR", order_id: orderNumber, num_items: 2 },
    })
    // Only hashes and Meta's own cookie: no raw email, phone or IP.
    const raw = JSON.stringify(event)
    expect(raw).not.toContain(user.rows[0]!.email)
    expect(raw).not.toContain("9876543210")
    expect(raw).not.toContain("client_ip_address")
  })

  it("drops malformed browser cookies instead of storing them", async () => {
    const customer = await buyer()
    const orderNumber = await paidOrder(customer, variantId, {
      marketingContext: {
        fbp: "<script>",
        fbc: "fb.1.1700000000000.AbC-123",
      },
    })
    const stored = await db().execute<{ context: unknown }>(
      sql`select marketing_context as context from orders where order_number = ${orderNumber}`,
    )
    expect(stored.rows[0]!.context).toEqual({
      fbc: "fb.1.1700000000000.AbC-123",
    })
  })
})
