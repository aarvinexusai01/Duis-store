import { describe, expect, it } from "vitest"

import { nextShipmentStatus, normaliseCourierStatus } from "./status"

const at = (minute: number) => new Date(Date.UTC(2026, 9, 16, 10, minute))

describe("normaliseCourierStatus", () => {
  it("maps courier words whatever their case and separators", () => {
    expect(normaliseCourierStatus("Out For Delivery")).toBe("out_for_delivery")
    expect(normaliseCourierStatus("RTO_DELIVERED")).toBe("rto_delivered")
    expect(normaliseCourierStatus(" picked-up ")).toBe("picked_up")
  })

  it("returns null for unknown words", () => {
    expect(normaliseCourierStatus("SOMETHING NEW")).toBeNull()
  })
})

describe("nextShipmentStatus", () => {
  it("moves forward", () => {
    expect(
      nextShipmentStatus("ready_to_ship", null, {
        status: "picked_up",
        occurredAt: at(1),
      }),
    ).toBe("picked_up")
  })

  it("ignores an older event that arrives late", () => {
    expect(
      nextShipmentStatus("out_for_delivery", at(5), {
        status: "in_transit",
        occurredAt: at(2),
      }),
    ).toBeNull()
  })

  it("lets delivery attempts alternate by time", () => {
    expect(
      nextShipmentStatus("undelivered", at(5), {
        status: "out_for_delivery",
        occurredAt: at(9),
      }),
    ).toBe("out_for_delivery")
    expect(
      nextShipmentStatus("out_for_delivery", at(9), {
        status: "undelivered",
        occurredAt: at(3),
      }),
    ).toBeNull()
  })

  it("never changes a finished shipment", () => {
    expect(
      nextShipmentStatus("delivered", at(5), {
        status: "rto_initiated",
        occurredAt: at(9),
      }),
    ).toBeNull()
  })

  it("does not leave a return for the delivery path", () => {
    expect(
      nextShipmentStatus("rto_initiated", at(5), {
        status: "out_for_delivery",
        occurredAt: at(9),
      }),
    ).toBeNull()
  })

  it("ignores unmapped events", () => {
    expect(
      nextShipmentStatus("in_transit", null, {
        status: null,
        occurredAt: at(1),
      }),
    ).toBeNull()
  })
})
