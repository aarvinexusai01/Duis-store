import { randomUUID } from "node:crypto"

import { sql } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"

import { subscribeStockAlert } from "@/features/alerts"
import { placeOrder } from "@/features/checkout"
import { sendContactMessage } from "@/features/contact"
import {
  saveAddress,
  setDeletionRequest,
  setMarketingConsent,
} from "@/features/customers"
import { requestExchange } from "@/features/exchanges"
import { subscribeNewsletter } from "@/features/marketing"
import { uploadCustomerPhoto } from "@/features/media"
import { cancelOrder } from "@/features/orders"
import {
  adminDataRequests,
  eraseCustomer,
  exportMyData,
  getPrivacyOverview,
  setNominee,
  withdrawConsent,
} from "@/features/privacy/service"
import { submitReview } from "@/features/reviews"
import { creditWallet } from "@/features/wallet"
import {
  ACCOUNT_CONSENT_COOKIE,
  NOTICE_VERSION,
  consentFromForm,
} from "@/lib/privacy"
import { anonymousActor, type Actor } from "@/server/auth/actor"
import { getAuth } from "@/server/auth/auth"
import { getDb, getPool } from "@/server/db/client"
import { withTransaction } from "@/server/db/transaction"
import { hasCurrentConsent, recordConsents } from "@/server/privacy"

import { createUserActor, unique } from "../helpers/actors"
import { closeConnectionsAfterAll } from "../helpers/cleanup"
import {
  buyer,
  code,
  paidOrder,
  sellableProduct,
  type Buyer,
} from "../helpers/shop"

closeConnectionsAfterAll()

const db = () => getDb()
const id = "00000000-0000-4000-8000-000000000000"
let customer: Buyer

async function consents(where: ReturnType<typeof sql>) {
  const { rows } = await db().execute<{
    user_id: string | null
    subject_hash: string | null
    purpose: string
    granted: boolean
    notice_version: string
    language: string
    source: string
  }>(sql`select * from data_consents where ${where} order by created_at`)
  return rows
}

beforeAll(async () => {
  customer = await buyer()
})

describe("every form needs its box ticked (DPDP Act s.6)", () => {
  const anon = (): Actor => anonymousActor()
  // Sent exactly as a form without the tick would be: no `consent` at all.
  const refused: [string, () => Promise<unknown>][] = [
    [
      "contact",
      () =>
        sendContactMessage(anon(), {
          name: "Asha",
          email: "a@duis.test",
          topic: "other",
          message: "Where is my parcel, please?",
        } as never),
    ],
    [
      "stock alert",
      () =>
        subscribeStockAlert(anon(), {
          variantId: id,
          email: "a@duis.test",
        } as never),
    ],
    [
      "newsletter",
      () => subscribeNewsletter(anon(), { email: "a@duis.test" } as never),
    ],
    [
      "address",
      () =>
        saveAddress(customer, {
          fullName: "Asha Rao",
          phone: "9876543210",
          line1: "1 Hazratganj",
          city: "Lucknow",
          stateCode: "IN-UP",
          postalCode: "226001",
          countryCode: "IN",
        } as never),
    ],
    [
      "order",
      () =>
        placeOrder(customer, {
          addressId: id,
          paymentMode: "prepaid",
          quoteHash: "0".repeat(32),
          idempotencyKey: randomUUID(),
        } as never),
    ],
    [
      "review",
      () =>
        submitReview(customer, {
          orderItemId: id,
          rating: 5,
          body: "Lovely heavy cotton.",
        } as never),
    ],
    [
      "exchange",
      () =>
        requestExchange(customer, {
          orderNumber: "DUIS-100001",
          orderItemId: id,
          variantId: id,
          quantity: 1,
          reason: "too_small",
        } as never),
    ],
    [
      "photo",
      () =>
        uploadCustomerPhoto(customer, {
          bytes: new Uint8Array([1]),
          purpose: "review",
        } as never),
    ],
  ]

  it.each(refused)("%s is refused without it", async (_name, send) => {
    expect(await code(send() as Promise<never>)).toBe("VALIDATION_FAILED")
  })

  it("an unticked form field never counts as a tick", () => {
    const form = new FormData()
    expect(consentFromForm(form).consent).toBe(false)
    form.set("consent", "true")
    form.set("consentLanguage", "hi")
    expect(consentFromForm(form)).toEqual({
      consent: true,
      consentLanguage: "hi",
    })
  })
})

describe("the record is the proof (s.6(10))", () => {
  it("keeps the notice version and language, and only a hash of a guest's email", async () => {
    const email = `${unique("guest")}@duis.test`
    const { id: messageId } = await sendContactMessage(anonymousActor(), {
      name: "Asha",
      email,
      topic: "other",
      message: "Where is my parcel, please?",
      consent: true,
      consentLanguage: "hi",
    })
    const [row] = await consents(
      sql`reference_id = ${messageId} and purpose = 'contact'`,
    )
    expect(row).toMatchObject({
      user_id: null,
      granted: true,
      notice_version: NOTICE_VERSION,
      language: "hi",
      source: "contact_form",
    })
    expect(row!.subject_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(row)).not.toContain(email)
  })

  it("can't be rewritten or deleted by the app", async () => {
    await expect(
      getPool().query("update data_consents set granted = false"),
    ).rejects.toThrow(/permission denied/)
    await expect(getPool().query("delete from data_consents")).rejects.toThrow(
      /permission denied/,
    )
  })

  it("records marketing changes of mind, and the latest answer wins", async () => {
    const user = await createUserActor("customer")
    if (user.kind !== "user") throw new Error("expected a user")
    const set = (marketingEmail: boolean) =>
      setMarketingConsent(user, { marketingEmail, marketingWhatsapp: false })
    await set(true)
    expect(await hasCurrentConsent(db(), user.userId, "marketing")).toBe(true)
    await set(true) // no change, no new row
    await set(false)
    expect(await hasCurrentConsent(db(), user.userId, "marketing")).toBe(false)
    const rows = await consents(
      sql`user_id = ${user.userId} and purpose = 'marketing'`,
    )
    expect(rows.map((r) => r.granted)).toEqual([true, false])
    expect(rows[0]!.source).toBe("account_settings")
  })

  it("needs someone to attach it to", async () => {
    await expect(
      recordConsents(db(), { purposes: ["contact"], source: "test" }),
    ).rejects.toThrow(/user or a subject/)
  })
})

describe("creating an account", () => {
  const post = (path: string, body: unknown, cookie?: string) =>
    getAuth().handler(
      new Request(
        `${process.env.APP_URL ?? "http://localhost:3000"}/api/auth${path}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: process.env.APP_URL ?? "http://localhost:3000",
            ...(cookie ? { cookie } : {}),
          },
          body: JSON.stringify(body),
        },
      ),
    )
  const signUp = (email: string, cookie?: string) =>
    post(
      "/sign-up/email",
      { email, password: "correct-horse-battery-9", name: "Test Shopper" },
      cookie,
    )
  const ticked = `${ACCOUNT_CONSENT_COOKIE}=${NOTICE_VERSION}.hi`

  it("is refused without the boxes, or with an old notice's", async () => {
    const email = `${unique("noconsent")}@duis.test`
    expect((await signUp(email)).status).toBe(400)
    expect(
      (await signUp(email, `${ACCOUNT_CONSENT_COOKIE}=2020-01-01.en`)).status,
    ).toBe(400)
    const phone = await post("/phone-number/send-otp", {
      phoneNumber: "+919876500000",
    })
    expect(phone.status).toBe(400)
    const google = await post("/sign-in/social", { provider: "google" })
    expect(google.status).toBe(400)
    const found = await db().execute(
      sql`select 1 from users where email = ${email}`,
    )
    expect(found.rows).toHaveLength(0)
  })

  it("records the account and age consents with the language chosen", async () => {
    const email = `${unique("consented")}@duis.test`
    expect((await signUp(email, ticked)).ok).toBe(true)
    const user = await db().execute<{ id: string }>(
      sql`select id from users where email = ${email}`,
    )
    const rows = await consents(sql`user_id = ${user.rows[0]!.id}`)
    expect(rows.map((r) => [r.purpose, r.language, r.source]).sort()).toEqual([
      ["account", "hi", "sign_up"],
      ["age", "hi", "sign_up"],
    ])
  })
})

describe("My account → Privacy & data", () => {
  it("withdraws a consent, stops the use, and shows it", async () => {
    const user = await buyer()
    await db().execute(sql`
      insert into customer_profiles (user_id, marketing_email_consent_at) values (${user.userId}, now())
      on conflict (user_id) do update set marketing_email_consent_at = now()`)
    let overview = await getPrivacyOverview(user, {})
    expect(
      overview.consents.find((c) => c.purpose === "marketing"),
    ).toMatchObject({ granted: true, canWithdraw: true })

    await withdrawConsent(user, { purpose: "marketing" })
    overview = await getPrivacyOverview(user, {})
    expect(
      overview.consents.find((c) => c.purpose === "marketing"),
    ).toMatchObject({ granted: false, canWithdraw: false })
    const profile = await db().execute<{ at: Date | null }>(sql`
      select marketing_email_consent_at as at from customer_profiles where user_id = ${user.userId}`)
    expect(profile.rows[0]!.at).toBeNull()
  })

  it("removes saved addresses when that consent is withdrawn", async () => {
    const user = await buyer()
    await withdrawConsent(user, { purpose: "address" })
    const left = await db().execute(
      sql`select 1 from addresses where user_id = ${user.userId}`,
    )
    expect(left.rows).toHaveLength(0)
  })

  it("downloads only the customer's own data", async () => {
    const user = await buyer()
    const other = await buyer()
    const { variantId } = await sellableProduct()
    const number = await paidOrder(user, variantId)
    await paidOrder(other, variantId)
    const data = await exportMyData(user, {})
    expect(data.orders.map((o) => o.order_number)).toEqual([number])
    expect(data.addresses).toHaveLength(1)
    expect(data.consents.length).toBeGreaterThan(0)
    expect(JSON.stringify(data)).not.toContain(other.userId)
    expect(await code(exportMyData(anonymousActor(), {}))).toBe(
      "UNAUTHENTICATED",
    )
  })

  it("saves a nominee only with the box ticked, and removes them", async () => {
    const user = await buyer()
    expect(
      await code(
        setNominee(user, {
          action: "save",
          name: "Asha Rao",
          contact: "asha@duis.test",
        } as never),
      ),
    ).toBe("VALIDATION_FAILED")
    await setNominee(user, {
      action: "save",
      name: "Asha Rao",
      contact: "asha@duis.test",
      consent: true,
    })
    expect((await getPrivacyOverview(user, {})).nominee).toEqual({
      name: "Asha Rao",
      contact: "asha@duis.test",
    })
    await setNominee(user, { action: "remove" })
    expect((await getPrivacyOverview(user, {})).nominee).toBeNull()
  })
})

describe("deleting an account", () => {
  const admin = () => createUserActor("store_admin")
  const ask = (user: Buyer) => setDeletionRequest(user, { requested: true })

  it("is for staff who may erase, and only after the customer asked", async () => {
    const user = await buyer()
    const support = await createUserActor("support_agent")
    expect(await code(eraseCustomer(support, { userId: user.userId }))).toBe(
      "FORBIDDEN",
    )
    expect(await code(eraseCustomer(user, { userId: user.userId }))).toBe(
      "FORBIDDEN",
    )
    expect(
      await code(eraseCustomer(await admin(), { userId: user.userId })),
    ).toBe("INVALID_STATE")
  })

  it("waits for open orders, wallet money, and refuses staff accounts", async () => {
    const staff = (await admin()) as Actor & { userId: string }
    const eraser = await admin()
    await setDeletionRequest(staff, { requested: true })
    expect(await code(eraseCustomer(eraser, { userId: staff.userId }))).toBe(
      "CONFLICT",
    )

    const user = await buyer()
    const { variantId } = await sellableProduct()
    await paidOrder(user, variantId)
    await ask(user)
    expect(await code(eraseCustomer(eraser, { userId: user.userId }))).toBe(
      "CONFLICT",
    )

    const rich = await buyer()
    await withTransaction((tx) =>
      creditWallet(tx, {
        userId: rich.userId,
        amountPaise: 500,
        reason: "goodwill",
        idempotencyKey: `gw:${randomUUID()}`,
      }),
    )
    await ask(rich)
    expect(await code(eraseCustomer(eraser, { userId: rich.userId }))).toBe(
      "CONFLICT",
    )
  })

  it("removes personal data, keeps the tax record, and leaves the invariants whole", async () => {
    const user = await buyer()
    const { variantId } = await sellableProduct()
    const number = await paidOrder(user, variantId)
    const before = await db().execute<{
      email: string
      total_paise: number
      order_id: string
    }>(sql`
      select u.email, o.total_paise, o.id as order_id from users u
      join orders o on o.user_id = u.id where o.order_number = ${number}`)
    const { email, total_paise, order_id } = before.rows[0]!
    await cancelOrder(user, { orderNumber: number })
    await db().execute(sql`
      update refunds set status = 'processed' where order_id = ${order_id}`)
    await sendContactMessage(user, {
      name: "Test Buyer",
      email,
      topic: "privacy",
      message: "Please delete my data, thank you.",
      consent: true,
    })
    await setNominee(user, {
      action: "save",
      name: "Asha Rao",
      contact: "asha@duis.test",
      consent: true,
    })
    await ask(user)
    const requests = await adminDataRequests(await admin(), {})
    const asked = requests.deletions.find((d) => d.userId === user.userId)
    expect(asked!.dueAt.getTime() - asked!.requestedAt.getTime()).toBe(
      30 * 86_400_000,
    )
    expect(requests.messages.some((m) => m.name === "Test Buyer")).toBe(true)

    await eraseCustomer(await admin(), { userId: user.userId })

    const after = await db().execute<{
      name: string
      email: string
      phone_number: string | null
      banned: boolean
    }>(
      sql`select name, email, phone_number, banned from users where id = ${user.userId}`,
    )
    expect(after.rows[0]).toMatchObject({
      name: "Deleted customer",
      phone_number: null,
      banned: true,
    })
    expect(after.rows[0]!.email).toMatch(/\.invalid$/)
    const order = await db().execute<{
      customer_name: string
      customer_email: string | null
      total_paise: number
      shipping_address: Record<string, string>
    }>(sql`select * from orders where order_number = ${number}`)
    expect(order.rows[0]).toMatchObject({
      customer_name: "Deleted customer",
      customer_email: null,
      total_paise,
    })
    expect(order.rows[0]!.shipping_address).toMatchObject({
      fullName: "Deleted customer",
      phone: "",
      line1: "Removed",
      city: "Lucknow",
      postalCode: expect.any(String),
    })
    for (const table of ["addresses", "sessions", "accounts"]) {
      const left = await db().execute(
        sql`select 1 from ${sql.identifier(table)} where user_id = ${user.userId}`,
      )
      expect(left.rows, table).toHaveLength(0)
    }
    const message = await db().execute<{ message: string; email: string }>(sql`
      select message, email from contact_messages where user_id = ${user.userId}`)
    expect(message.rows[0]!.message).toContain("removed")
    expect(message.rows[0]!.email).not.toBe(email)
    const profile = await db().execute<{
      nominee: string | null
      at: Date
    }>(sql`
      select nominee_name as nominee, erased_at as at from customer_profiles where user_id = ${user.userId}`)
    expect(profile.rows[0]!.nominee).toBeNull()
    expect(profile.rows[0]!.at).not.toBeNull()
    // The proof of consent survives, and says it ended.
    const [last] = (
      await consents(sql`user_id = ${user.userId} and purpose = 'account'`)
    ).slice(-1)
    expect(last).toMatchObject({ granted: false, source: "account_deleted" })
    // The goodbye email goes to the old address.
    const bye = await db().execute(sql`
      select 1 from pgboss.job where name = 'notify.email'
        and data->>'template' = 'account-deleted' and data->>'to' = ${email}`)
    expect(bye.rows).toHaveLength(1)
    // Done once.
    expect(
      await code(eraseCustomer(await admin(), { userId: user.userId })),
    ).toBe("INVALID_STATE")
    expect(
      (await adminDataRequests(await admin(), {})).deletions.some(
        (d) => d.userId === user.userId,
      ),
    ).toBe(false)
  })
})
