import { describe, expect, it } from "vitest"

import {
  getHelperState,
  getHelperTodos,
  updateHelperPrefs,
} from "@/features/helper"
import { isDomainError } from "@/server/errors"

import { actorWithRole, createUserActor } from "../helpers/actors"
import { createProductFixture } from "../helpers/catalog"
import { closeConnectionsAfterAll } from "../helpers/cleanup"
import { sellableProduct } from "../helpers/shop"

closeConnectionsAfterAll()

const keys = (state: { checklist: { key: string }[] }) =>
  state.checklist.map((item) => item.key)

describe("admin helper", () => {
  it("starts visible with the tour not done, and saves each person's choices", async () => {
    const staff = await createUserActor("store_admin")
    expect(await getHelperState(staff, {})).toMatchObject({
      hidden: false,
      tourDone: false,
    })

    expect(await updateHelperPrefs(staff, { tourDone: true })).toEqual({
      hidden: false,
      tourDone: true,
      seenGuides: [],
    })
    expect(await updateHelperPrefs(staff, { hidden: true })).toEqual({
      hidden: true,
      tourDone: true,
      seenGuides: [],
    })
    expect(await updateHelperPrefs(staff, { hidden: false })).toEqual({
      hidden: false,
      tourDone: true,
      seenGuides: [],
    })

    // Someone else's settings are their own.
    const other = await createUserActor("store_admin")
    expect(await getHelperState(other, {})).toMatchObject({
      hidden: false,
      tourDone: false,
    })
  })

  it("lists only the getting-started steps each role can do", async () => {
    const store = await getHelperState(actorWithRole("store_admin"), {})
    expect(keys(store)).toEqual([
      "category",
      "product",
      "variants",
      "stock",
      "publish",
      "discount",
      "media",
    ])

    const editor = await getHelperState(actorWithRole("content_editor"), {})
    expect(keys(editor)).toEqual(["media", "story"])

    const fulfilment = await getHelperState(
      actorWithRole("fulfilment_staff"),
      {},
    )
    expect(fulfilment.checklist).toEqual([])

    for (const item of store.checklist) {
      expect(typeof item.done).toBe("boolean")
      expect(item.href).toMatch(/^\/admin/)
    }
  })

  it("remembers each guide once: the walkthrough and page tours", async () => {
    const staff = await createUserActor("store_admin")
    await updateHelperPrefs(staff, { seenGuide: "page:/admin/inventory" })
    await updateHelperPrefs(staff, { seenGuide: "product-walkthrough" })
    const again = await updateHelperPrefs(staff, {
      seenGuide: "page:/admin/inventory",
    })
    expect(again.seenGuides).toEqual([
      "page:/admin/inventory",
      "product-walkthrough",
    ])
    expect((await getHelperState(staff, {})).seenGuides).toEqual(
      again.seenGuides,
    )
    for (const seenGuide of ["page:/shop", "tour", "page:/admin/<x>"]) {
      await expect(updateHelperPrefs(staff, { seenGuide })).rejects.toSatisfy(
        (error) => isDomainError(error) && error.code === "VALIDATION_FAILED",
      )
    }
  })

  it("counts today's to-dos from store data, for the roles that act on them", async () => {
    const admin = actorWithRole("store_admin")
    const count = async () =>
      Object.fromEntries(
        (await getHelperTodos(admin, {})).map((t) => [t.key, t.count]),
      ) as Record<string, number>
    const before = await count()

    // A draft in two colours without photos, and a live product in two
    // colours with a photo for one, nothing in stock (2 × 3 sizes each).
    await createProductFixture()
    await sellableProduct(0)

    const after = await count()
    expect(after.drafts).toBe((before.drafts ?? 0) + 1)
    expect(after.soldout).toBe((before.soldout ?? 0) + 6)
    expect(after.photos).toBe((before.photos ?? 0) + 2)

    const todos = await getHelperTodos(admin, {})
    expect(todos.find((t) => t.key === "drafts")).toMatchObject({
      href: "/admin/products?status=draft",
      label: expect.stringMatching(/^\d+ draft products? to finish$/),
    })
    expect(todos.every((t) => t.count > 0)).toBe(true)
    expect((await getHelperState(admin, {})).todos).toEqual(todos)

    // A content editor can't act on orders, products or stock.
    const editor = await getHelperTodos(actorWithRole("content_editor"), {})
    expect(editor.map((t) => t.key)).not.toContain("drafts")
    expect(editor.map((t) => t.key)).not.toContain("soldout")
    expect(editor.map((t) => t.key)).not.toContain("ship")
  })

  it("refuses customers and empty changes", async () => {
    const customer = actorWithRole("customer")
    await expect(getHelperState(customer, {})).rejects.toSatisfy(
      (error) => isDomainError(error) && error.code === "FORBIDDEN",
    )
    await expect(getHelperTodos(customer, {})).rejects.toSatisfy(
      (error) => isDomainError(error) && error.code === "FORBIDDEN",
    )
    await expect(
      updateHelperPrefs(customer, { hidden: true }),
    ).rejects.toSatisfy(
      (error) => isDomainError(error) && error.code === "FORBIDDEN",
    )
    await expect(
      updateHelperPrefs(actorWithRole("store_admin"), {}),
    ).rejects.toSatisfy(
      (error) => isDomainError(error) && error.code === "VALIDATION_FAILED",
    )
  })
})
