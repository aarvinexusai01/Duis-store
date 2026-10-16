import { createHash, randomBytes, randomUUID } from "node:crypto"

import { sql } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { addCartItem, getCart } from "@/features/cart"
import { sendLowStockDigest } from "@/features/inventory"
import { exportGstCsv, exportOrdersCsv, salesReport } from "@/features/reports"
import {
  addTaxRule,
  getAdminSettings,
  loadStorePolicy,
  updateCodSettings,
  updateLegalSettings,
  updateNotificationSettings,
  updateShippingSettings,
} from "@/features/settings"
import {
  acceptInvitation,
  adminSearch,
  getInvitation,
  inviteStaff,
  listStaff,
  resetStaffTwoFactor,
  setStaffActive,
  setStaffRoles,
} from "@/features/staff"
import {
  getSystemStatus,
  listAuditLogs,
  retryFailedJob,
} from "@/features/system"
import { parseCsv } from "@/lib/csv"
import { anonymousActor, type Actor } from "@/server/auth/actor"
import { getDb } from "@/server/db/client"
import { queueEmail } from "@/server/notifications/email"

import { createUserActor } from "../helpers/actors"
import { closeConnectionsAfterAll } from "../helpers/cleanup"
import { buyer, code, paidOrder, sellableProduct } from "../helpers/shop"

closeConnectionsAfterAll()

const db = () => getDb()
let variantId: string
let superAdmin: Actor
let admin: Actor
let packer: Actor
let original: Awaited<ReturnType<typeof getAdminSettings>>

beforeAll(async () => {
  ;({ variantId } = await sellableProduct())
  superAdmin = await createUserActor("super_admin")
  admin = await createUserActor("store_admin")
  packer = await createUserActor("fulfilment_staff")
  original = await getAdminSettings(admin, {})
})

// Settings are shared by every test file: put them back.
afterAll(async () => {
  await db().execute(sql`
    update store_settings set free_shipping_threshold_paise = ${original.freeShippingThresholdPaise},
      partial_cod_enabled = ${original.partialCodEnabled}, cod_advance_type = ${original.codAdvanceType},
      cod_advance_value = ${original.codAdvanceValue}, gstin = ${original.gstin},
      notify_order_shipped = true, notify_low_stock = true, notify_payment_reminder = true
    where id = 1`)
})

const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })

describe("settings", () => {
  it("changes the free-shipping threshold for the bag, and audits the change", async () => {
    await updateShippingSettings(admin, {
      freeShippingThresholdPaise: 200_000,
      internationalCountryCodes: original.internationalCountryCodes,
    })
    expect((await loadStorePolicy()).freeShippingThresholdPaise).toBe(200_000)
    const customer = await buyer()
    await addCartItem(customer, { variantId, quantity: 1 })
    const cart = await getCart(customer, {})
    expect(cart.amountToFreeShippingPaise).toBe(200_000 - cart.subtotalPaise)

    const audit = await listAuditLogs(admin, {
      action: "settings.update_shipping",
    })
    expect(audit.rows[0]!.changes).toMatchObject({
      freeShippingThresholdPaise: {
        from: original.freeShippingThresholdPaise,
        to: 200_000,
      },
    })
  })

  it("validates GSTIN and the COD advance", async () => {
    expect(
      await code(
        updateLegalSettings(admin, {
          legalName: "Duis Apparel",
          gstin: "not-a-gstin",
          registeredStateCode: "IN-UP",
          iecCode: "",
          lutReference: "",
        }),
      ),
    ).toBe("VALIDATION_FAILED")
    expect(
      await code(
        updateCodSettings(admin, {
          partialCodEnabled: true,
          codAdvanceType: "percent",
          codAdvanceValue: 9_500,
          codMaxOrderPaise: 250_000,
          codFeePaise: 500,
          rtoAdvancePolicy: "keep",
        }),
      ),
    ).toBe("VALIDATION_FAILED")
    expect(
      await code(
        updateShippingSettings(packer, {
          freeShippingThresholdPaise: 0,
          internationalCountryCodes: [],
        }),
      ),
    ).toBe("FORBIDDEN")
  })

  it("turns optional emails off, never the required ones", async () => {
    await updateNotificationSettings(admin, {
      emailSenderName: "Duis Store",
      emailReplyTo: "help@duis.test",
      notifyOrderShipped: false,
      notifyPaymentReminder: true,
      notifyLowStock: true,
    })
    const props = {
      name: "A",
      orderNumber: "DUIS-100001",
      url: "https://duis.test/o",
      courier: "Demo",
      awb: "FK1",
    }
    expect(
      await queueEmail({ template: "order-shipped", to: "a@duis.test", props }),
    ).toBeNull()
    expect(
      await queueEmail({
        template: "refund-issued",
        to: "a@duis.test",
        props: { ...props, amount: "₹1" },
      }),
    ).not.toBeNull()
  })

  it("adds a tax rule from a date, ending the previous one", async () => {
    const prefix = String(90 + Math.floor(Math.random() * 9))
    await db().execute(sql`
      insert into tax_rules (hsn_prefix, rate_below_bp, rate_above_bp, effective_from)
      values (${prefix}, 500, 500, '2025-01-01')`)
    const from = "2099-01-01"
    await addTaxRule(admin, {
      hsnPrefix: prefix,
      priceThresholdPaise: null,
      rateBelowBp: 1_200,
      rateAboveBp: 1_200,
      effectiveFrom: from,
    })
    const rules = await db().execute<{
      effective_from: string
      effective_to: string | null
    }>(sql`
      select effective_from::text, effective_to::text from tax_rules where hsn_prefix = ${prefix} order by effective_from`)
    expect(rules.rows).toEqual([
      { effective_from: "2025-01-01", effective_to: "2098-12-31" },
      { effective_from: "2099-01-01", effective_to: null },
    ])
    expect(
      await code(
        addTaxRule(admin, {
          hsnPrefix: prefix,
          priceThresholdPaise: null,
          rateBelowBp: 500,
          rateAboveBp: 500,
          effectiveFrom: "2098-06-01",
        }),
      ),
    ).toBe("CONFLICT")
    await db().execute(sql`delete from tax_rules where hsn_prefix = ${prefix}`)
  })
})

describe("staff", () => {
  it("invites by email; the link creates a verified staff account once", async () => {
    const email = `new-staff-${randomUUID().slice(0, 8)}@duis.test`
    await inviteStaff(superAdmin, { email, roles: ["support_agent"] })
    const sent = await db().execute<{ id: string }>(sql`
      select n.id from notification_logs n join staff_invitations i on i.id::text = n.reference_id
      where i.email = ${email} and n.template = 'staff-invite'`)
    expect(sent.rows).toHaveLength(1)

    // The token only exists in the email; recreate one for the test.
    const token = randomBytes(32).toString("base64url")
    await db().execute(sql`
      update staff_invitations set token_hash = ${createHash("sha256").update(token).digest("hex")}
      where email = ${email} and accepted_at is null and revoked_at is null`)

    expect(await getInvitation(anonymousActor(), { token })).toMatchObject({
      status: "valid",
      email,
      hasAccount: false,
    })
    await acceptInvitation(anonymousActor(), {
      token,
      name: "New Support",
      password: "Support-Passw0rd!",
    })
    const user = await db().execute<{ role: string; email_verified: boolean }>(
      sql`select role, email_verified from users where email = ${email}`,
    )
    expect(user.rows[0]).toEqual({
      role: "support_agent",
      email_verified: true,
    })
    expect((await getInvitation(anonymousActor(), { token })).status).toBe(
      "used",
    )
    expect(
      await code(
        acceptInvitation(anonymousActor(), {
          token,
          name: "Again",
          password: "Support-Passw0rd!",
        }),
      ),
    ).toBe("INVALID_STATE")
    expect(
      await code(inviteStaff(superAdmin, { email, roles: ["store_admin"] })),
    ).toBe("CONFLICT")
    expect(
      await code(
        inviteStaff(admin, { email: "x@duis.test", roles: ["store_admin"] }),
      ),
    ).toBe("FORBIDDEN")
  })

  it("changes roles, resets 2FA and deactivates, but not yourself", async () => {
    const person = await createUserActor("support_agent")
    const userId = (person as { userId: string }).userId
    await setStaffRoles(superAdmin, {
      userId,
      roles: ["support_agent", "fulfilment_staff"],
    })
    const staff = await listStaff(superAdmin, {})
    expect(staff.members.find((m) => m.id === userId)?.roles.sort()).toEqual([
      "fulfilment_staff",
      "support_agent",
    ])
    await resetStaffTwoFactor(superAdmin, { userId })
    await setStaffActive(superAdmin, { userId, active: false })
    const after = (await listStaff(superAdmin, {})).members.find(
      (m) => m.id === userId,
    )!
    expect(after).toMatchObject({ twoFactorEnabled: false, active: false })

    const selfId = (superAdmin as { userId: string }).userId
    expect(
      await code(setStaffActive(superAdmin, { userId: selfId, active: false })),
    ).toBe("INVALID_STATE")
    expect(
      await code(resetStaffTwoFactor(superAdmin, { userId: selfId })),
    ).toBe("INVALID_STATE")
  })

  it("never removes the last active Super Admin", async () => {
    const selfId = (superAdmin as { userId: string }).userId
    // Temporarily the only active Super Admin with 2FA.
    const others = await db().execute<{ id: string }>(sql`
      update users set banned = true
      where id <> ${selfId} and coalesce(banned, false) = false
        and 'super_admin' = any(regexp_split_to_array(trim(role), '\\s*,\\s*'))
      returning id`)
    try {
      expect(
        await code(
          setStaffRoles(superAdmin, { userId: selfId, roles: ["store_admin"] }),
        ),
      ).toBe("CONFLICT")
    } finally {
      const ids = others.rows.map((r) => r.id)
      if (ids.length > 0) {
        await db().execute(sql`
          update users set banned = false where id in (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})`)
      }
    }
  })
})

describe("reports and exports", () => {
  it("exports GST lines that add up to each order's total, safe for spreadsheets", async () => {
    const customer = await buyer()
    const number = await paidOrder(customer, variantId)
    // A name a spreadsheet would run as a formula.
    await db().execute(
      sql`update orders set customer_name = '=HYPERLINK("x")' where order_number = ${number}`,
    )
    const order = await db().execute<{ total_paise: number }>(
      sql`select total_paise from orders where order_number = ${number}`,
    )
    const { csv } = await exportGstCsv(admin, { from: today(), to: today() })
    const [header, ...rows] = parseCsv(csv)
    const col = (name: string) => header!.indexOf(name)
    const mine = rows.filter((r) => r[col("order_number")] === number)
    expect(mine.map((r) => r[col("line_type")])).toEqual(["goods", "charges"])
    const sum = mine.reduce(
      (s, r) => s + Math.round(Number(r[col("line_total")]) * 100),
      0,
    )
    expect(sum).toBe(order.rows[0]!.total_paise)
    expect(mine[0]![col("customer_name")]!.startsWith("'=")).toBe(true)
    expect(mine[0]![col("supply_type")]).toBe("intra_state")

    const report = await salesReport(admin, { from: today(), to: today() })
    expect(report.totals.orders).toBeGreaterThan(0)
    expect(
      await code(exportGstCsv(packer, { from: today(), to: today() })),
    ).toBe("FORBIDDEN")
  })

  it("exports the orders list with its filters", async () => {
    const number = await paidOrder(await buyer(), variantId)
    const { csv } = await exportOrdersCsv(admin, { q: number })
    expect(parseCsv(csv)).toHaveLength(2)
    expect(csv).toContain(number)
    expect(await code(exportOrdersCsv(packer, {}))).toBe("FORBIDDEN")
  })
})

describe("system", () => {
  it("shows queues and refuses unknown queue names", async () => {
    const status = await getSystemStatus(superAdmin, {})
    expect(status.queues.map((q) => q.name)).toContain("notify.email")
    expect(
      await code(
        retryFailedJob(superAdmin, { queue: "nope", id: randomUUID() }),
      ),
    ).toBe("VALIDATION_FAILED")
    expect(await code(getSystemStatus(packer, {}))).toBe("FORBIDDEN")
  })

  it("searches only what the role can read", async () => {
    const number = await paidOrder(await buyer(), variantId)
    const forPacker = await adminSearch(packer, { q: number })
    expect(forPacker.map((h) => h.group)).toEqual(["Orders"])
    const forAdmin = await adminSearch(admin, { q: "Test customer" })
    expect(forAdmin.some((h) => h.group === "Customers")).toBe(true)
    const packerCustomers = await adminSearch(packer, { q: "Test customer" })
    expect(packerCustomers.some((h) => h.group === "Customers")).toBe(false)
    expect(await code(adminSearch(anonymousActor(), { q: number }))).toBe(
      "UNAUTHENTICATED",
    )
  })

  it("emails a low-stock digest to admins, unless turned off", async () => {
    await sellableProduct(2)
    expect(await sendLowStockDigest()).toBeGreaterThan(0)
    await db().execute(
      sql`update store_settings set notify_low_stock = false where id = 1`,
    )
    expect(await sendLowStockDigest()).toBe(0)
  })
})
