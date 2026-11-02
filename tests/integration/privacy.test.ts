import { randomUUID } from "node:crypto"

import { sql } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"

import { subscribeStockAlert } from "@/features/alerts"
import { placeOrder } from "@/features/checkout"
import { sendContactMessage } from "@/features/contact"
import { saveAddress, setMarketingConsent } from "@/features/customers"
import { requestExchange } from "@/features/exchanges"
import { subscribeNewsletter } from "@/features/marketing"
import { uploadCustomerPhoto } from "@/features/media"
import { submitReview } from "@/features/reviews"
import {
  ACCOUNT_CONSENT_COOKIE,
  NOTICE_VERSION,
  consentFromForm,
} from "@/lib/privacy"
import { anonymousActor, type Actor } from "@/server/auth/actor"
import { getAuth } from "@/server/auth/auth"
import { getDb, getPool } from "@/server/db/client"
import { hasCurrentConsent, recordConsents } from "@/server/privacy"

import { createUserActor, unique } from "../helpers/actors"
import { closeConnectionsAfterAll } from "../helpers/cleanup"
import { buyer, code, type Buyer } from "../helpers/shop"

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
