import { sql } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"

import {
  addCartItem,
  getCart,
  mergeGuestCart,
  updateCartItem,
} from "@/features/cart"
import { publishProduct, setProductMedia } from "@/features/catalog"
import {
  deleteAddress,
  getAccountOverview,
  listAddresses,
  saveAddress,
  setMarketingConsent,
} from "@/features/customers"
import { adjustStock } from "@/features/inventory"
import { confirmNewsletter, subscribeNewsletter } from "@/features/marketing"
import { uploadImage } from "@/features/media"
import { checkServiceability } from "@/features/shipping"
import {
  addWishlistItem,
  listWishlist,
  removeWishlistItem,
} from "@/features/wishlist"
import type { Actor } from "@/server/auth/actor"
import { getDb } from "@/server/db/client"
import { isDomainError } from "@/server/errors"

import { asSystem, createUserActor, unique } from "../helpers/actors"
import { createProductFixture } from "../helpers/catalog"
import { closeConnectionsAfterAll } from "../helpers/cleanup"
import { makeUniqueImage } from "../helpers/images"

closeConnectionsAfterAll()

const anonymous: Actor = { kind: "anonymous", requestId: "test", ip: null }
let fx: Awaited<ReturnType<typeof createProductFixture>>
let blackM: string
let blackS: string
let whiteL: string

async function variant(signature: string): Promise<string> {
  const { rows } = await getDb().execute<{ id: string }>(sql`
    select id from product_variants
    where product_id = ${fx.productId} and option_signature = ${signature}`)
  return rows[0]!.id
}

async function code(work: Promise<unknown>): Promise<string> {
  try {
    await work
    return "ok"
  } catch (error) {
    return isDomainError(error) ? error.code : String(error)
  }
}

beforeAll(async () => {
  fx = await createProductFixture()
  const image = await uploadImage(asSystem(), {
    bytes: await makeUniqueImage(),
  })
  await setProductMedia(asSystem(), {
    productId: fx.productId,
    items: [{ mediaId: image.id, colorValueId: fx.black }],
  })
  await publishProduct(asSystem(), { id: fx.productId })
  blackM = await variant("color=black;size=m")
  blackS = await variant("color=black;size=s")
  whiteL = await variant("color=white;size=l")
  await adjustStock(asSystem(), {
    variantId: blackM,
    delta: 12,
    reason: "receive",
  })
  await adjustStock(asSystem(), {
    variantId: blackS,
    delta: 2,
    reason: "receive",
  })
})

describe("guest cart", () => {
  it("creates a cart on first add and returns its token once", async () => {
    const first = await addCartItem(anonymous, {
      variantId: blackM,
      quantity: 2,
    })
    expect(first.newGuestToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const second = await addCartItem(anonymous, {
      guestToken: first.newGuestToken,
      variantId: blackM,
      quantity: 1,
    })
    expect(second).toEqual({ newGuestToken: undefined, quantity: 3 })

    const view = await getCart(anonymous, { guestToken: first.newGuestToken })
    expect(view.lines).toHaveLength(1)
    expect(view).toMatchObject({
      itemCount: 3,
      subtotalPaise: 3 * 79_900,
      mrpTotalPaise: 3 * 99_900,
      savingsPaise: 3 * 20_000,
      amountToFreeShippingPaise: 0,
      hasIssues: false,
    })
    expect(view.lines[0]!.options.map((o) => o.value)).toEqual(["Black", "M"])
    // Only the hash is stored.
    const stored = await getDb().execute(
      sql`select 1 from carts where anonymous_token_hash = ${first.newGuestToken!}`,
    )
    expect(stored.rows).toHaveLength(0)
  })

  it("enforces stock, the per-line maximum and unknown variants", async () => {
    const { newGuestToken: token } = await addCartItem(anonymous, {
      variantId: blackS,
      quantity: 2,
    })
    expect(
      await code(
        addCartItem(anonymous, {
          guestToken: token,
          variantId: blackS,
          quantity: 1,
        }),
      ),
    ).toBe("OUT_OF_STOCK")
    expect(
      await code(
        addCartItem(anonymous, {
          guestToken: token,
          variantId: whiteL,
          quantity: 1,
        }),
      ),
    ).toBe("OUT_OF_STOCK")
    expect(
      await code(
        addCartItem(anonymous, {
          guestToken: token,
          variantId: blackM,
          quantity: 11,
        }),
      ),
    ).toBe("VALIDATION_FAILED")
    await addCartItem(anonymous, {
      guestToken: token,
      variantId: blackM,
      quantity: 10,
    })
    expect(
      await code(
        addCartItem(anonymous, {
          guestToken: token,
          variantId: blackM,
          quantity: 1,
        }),
      ),
    ).toBe("CONFLICT")
    expect(
      await code(
        addCartItem(anonymous, {
          guestToken: token,
          variantId: crypto.randomUUID(),
          quantity: 1,
        }),
      ),
    ).toBe("NOT_FOUND")
  })

  it("lowers, removes and flags lines that went out of stock", async () => {
    const { newGuestToken: token } = await addCartItem(anonymous, {
      variantId: blackS,
      quantity: 2,
    })
    await updateCartItem(anonymous, {
      guestToken: token,
      variantId: blackS,
      quantity: 1,
    })
    expect((await getCart(anonymous, { guestToken: token })).itemCount).toBe(1)

    await adjustStock(asSystem(), {
      variantId: blackS,
      delta: -2,
      reason: "adjust",
    })
    const view = await getCart(anonymous, { guestToken: token })
    expect(view.lines[0]!.issue).toBe("sold_out")
    expect(view).toMatchObject({ subtotalPaise: 0, hasIssues: true })
    await adjustStock(asSystem(), {
      variantId: blackS,
      delta: 2,
      reason: "adjust",
    })

    await updateCartItem(anonymous, {
      guestToken: token,
      variantId: blackS,
      quantity: 0,
    })
    expect((await getCart(anonymous, { guestToken: token })).lines).toEqual([])
  })
})

describe("cart merge at sign-in", () => {
  it("adopts the guest cart when the customer has none", async () => {
    const customer = await createUserActor("customer")
    const { newGuestToken: token } = await addCartItem(anonymous, {
      variantId: blackM,
      quantity: 1,
    })
    await mergeGuestCart(customer, { guestToken: token! })
    expect((await getCart(customer, {})).itemCount).toBe(1)
    // The cookie no longer opens anything: the cart now belongs to the account.
    expect((await getCart(anonymous, { guestToken: token })).lines).toEqual([])
  })

  it("adds guest lines to the customer's cart, capped per line, and is idempotent", async () => {
    const customer = await createUserActor("customer")
    await addCartItem(customer, { variantId: blackM, quantity: 8 })
    const { newGuestToken: token } = await addCartItem(anonymous, {
      variantId: blackM,
      quantity: 5,
    })
    await addCartItem(anonymous, {
      guestToken: token,
      variantId: blackS,
      quantity: 1,
    })

    await mergeGuestCart(customer, { guestToken: token! })
    await mergeGuestCart(customer, { guestToken: token! })
    const view = await getCart(customer, {})
    expect(
      Object.fromEntries(view.lines.map((l) => [l.variantId, l.quantity])),
    ).toEqual({
      [blackM]: 10,
      [blackS]: 1,
    })
  })
})

describe("wishlist", () => {
  it("saves, lists and removes products for signed-in customers only", async () => {
    const customer = await createUserActor("customer")
    await addWishlistItem(customer, { productId: fx.productId })
    await addWishlistItem(customer, { productId: fx.productId })
    expect(await listWishlist(customer, {})).toEqual([fx.productId])
    await removeWishlistItem(customer, { productId: fx.productId })
    expect(await listWishlist(customer, {})).toEqual([])
    expect(
      await code(addWishlistItem(anonymous, { productId: fx.productId })),
    ).toBe("UNAUTHENTICATED")

    const draft = await createProductFixture()
    expect(
      await code(addWishlistItem(customer, { productId: draft.productId })),
    ).toBe("CONFLICT")
  })
})

describe("addresses", () => {
  const india = {
    fullName: "Asha Rao",
    phone: "98450 12345",
    line1: "12 MG Road",
    city: "Bengaluru",
    stateCode: "IN-KA",
    postalCode: "560001",
    countryCode: "IN",
  }

  it("validates by country and stores a normalised phone", async () => {
    const customer = await createUserActor("customer")
    expect(
      await code(saveAddress(customer, { ...india, postalCode: "56001" })),
    ).toBe("VALIDATION_FAILED")
    expect(
      await code(saveAddress(customer, { ...india, stateCode: undefined })),
    ).toBe("VALIDATION_FAILED")
    expect(
      await code(
        saveAddress(customer, {
          ...india,
          countryCode: "GB",
          stateCode: undefined,
          postalCode: "SW1A 1AA",
          phone: "07700 900123",
        }),
      ),
    ).toBe("VALIDATION_FAILED")

    await saveAddress(customer, india)
    await saveAddress(customer, {
      ...india,
      countryCode: "GB",
      stateCode: undefined,
      region: "London",
      postalCode: "SW1A 1AA",
      phone: "+44 7700 900123",
    })
    const saved = await listAddresses(customer, {})
    expect(saved.map((a) => [a.countryCode, a.phone, a.isDefault])).toEqual([
      ["IN", "+919845012345", true],
      ["GB", "+447700900123", false],
    ])
  })

  it("moves the default flag, promotes on delete and scopes to the owner", async () => {
    const customer = await createUserActor("customer")
    const other = await createUserActor("customer")
    const first = await saveAddress(customer, india)
    const second = await saveAddress(customer, { ...india, isDefault: true })
    let saved = await listAddresses(customer, {})
    expect(saved.find((a) => a.isDefault)!.id).toBe(second.id)

    expect(await code(deleteAddress(other, { id: second.id }))).toBe(
      "NOT_FOUND",
    )
    expect(await code(saveAddress(other, { ...india, id: first.id }))).toBe(
      "NOT_FOUND",
    )

    await deleteAddress(customer, { id: second.id })
    saved = await listAddresses(customer, {})
    expect(saved.map((a) => [a.id, a.isDefault])).toEqual([[first.id, true]])
  })
})

describe("marketing consent", () => {
  it("keeps the original consent time and clears it on withdrawal", async () => {
    const customer = await createUserActor("customer")
    await setMarketingConsent(customer, {
      marketingEmail: true,
      marketingWhatsapp: false,
    })
    const read = async () =>
      (
        await getDb().execute<{
          email: Date | null
          whatsapp: Date | null
        }>(sql`
          select marketing_email_consent_at as email, marketing_whatsapp_consent_at as whatsapp
          from customer_profiles where user_id = ${(customer as { userId: string }).userId}`)
      ).rows[0]!
    const before = await read()
    await setMarketingConsent(customer, {
      marketingEmail: true,
      marketingWhatsapp: true,
    })
    const after = await read()
    expect(after.email).toEqual(before.email)
    expect(after.whatsapp).not.toBeNull()
    await setMarketingConsent(customer, {
      marketingEmail: false,
      marketingWhatsapp: true,
    })
    expect((await read()).email).toBeNull()
    expect((await getAccountOverview(customer, {})).marketingWhatsapp).toBe(
      true,
    )
  })
})

describe("newsletter double opt-in", () => {
  it("confirms only through the emailed token and never re-sends within 10 minutes", async () => {
    const email = `${unique("fan")}@duis.test`
    await subscribeNewsletter(anonymous, { email, source: "footer" })
    await subscribeNewsletter(anonymous, {
      email: email.toUpperCase(),
      source: "footer",
    })

    const { rows } = await getDb().execute<{ url: string }>(sql`
      select data->'props'->>'url' as url from pgboss.job
      where name = 'notify.email' and data->>'to' = ${email}`)
    expect(rows).toHaveLength(1)
    const token = new URL(rows[0]!.url).searchParams.get("token")!

    expect(await confirmNewsletter(anonymous, { token: "x".repeat(43) })).toBe(
      "invalid",
    )
    expect(await confirmNewsletter(anonymous, { token })).toBe("confirmed")
    expect(await confirmNewsletter(anonymous, { token })).toBe("invalid")
    const status = await getDb().execute<{ status: string }>(
      sql`select status from newsletter_subscribers where email = ${email}`,
    )
    expect(status.rows[0]!.status).toBe("confirmed")
  })
})

describe("PIN-code serviceability", () => {
  it("answers from the provider, caches it and rejects malformed PINs", async () => {
    const first = await checkServiceability(anonymous, { pincode: "560001" })
    expect(first).toMatchObject({ serviceable: true, codAvailable: true })
    const cached = await getDb().execute<{ provider: string }>(
      sql`select provider from pincode_serviceability where pincode = '560001'`,
    )
    expect(cached.rows[0]!.provider).toBe("fake")
    expect(
      await checkServiceability(anonymous, { pincode: "990001" }),
    ).toMatchObject({ serviceable: false })
    expect(
      await code(checkServiceability(anonymous, { pincode: "012345" })),
    ).toBe("VALIDATION_FAILED")
  })
})
