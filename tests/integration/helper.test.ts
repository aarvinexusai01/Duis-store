import { describe, expect, it } from "vitest"

import { getHelperState, updateHelperPrefs } from "@/features/helper"
import { isDomainError } from "@/server/errors"

import { actorWithRole, createUserActor } from "../helpers/actors"
import { closeConnectionsAfterAll } from "../helpers/cleanup"

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
    })
    expect(await updateHelperPrefs(staff, { hidden: true })).toEqual({
      hidden: true,
      tourDone: true,
    })
    expect(await updateHelperPrefs(staff, { hidden: false })).toEqual({
      hidden: false,
      tourDone: true,
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

  it("refuses customers and empty changes", async () => {
    const customer = actorWithRole("customer")
    await expect(getHelperState(customer, {})).rejects.toSatisfy(
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
