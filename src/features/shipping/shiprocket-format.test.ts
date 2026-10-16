import { describe, expect, it } from "vitest"

import {
  parseShiprocketTime,
  parseShiprocketTracking,
  parseShiprocketWebhook,
} from "./shiprocket-format"

describe("parseShiprocketTime", () => {
  it("reads both formats as IST", () => {
    expect(parseShiprocketTime("2026-10-16 11:59:16")?.toISOString()).toBe(
      "2026-10-16T06:29:16.000Z",
    )
    expect(parseShiprocketTime("16 10 2026 11:59:16")?.toISOString()).toBe(
      "2026-10-16T06:29:16.000Z",
    )
  })

  it("rejects anything else", () => {
    expect(parseShiprocketTime("yesterday")).toBeNull()
    expect(parseShiprocketTime(42)).toBeNull()
  })
})

describe("parseShiprocketWebhook", () => {
  const body = {
    awb: "19041424751540",
    current_status: "Out for Delivery",
    current_timestamp: "16 10 2026 11:59:16",
    order_id: "DUIS-100150-1",
    scans: [
      {
        date: "2026-10-16 11:59:16",
        activity: "Out for delivery",
        location: "Lucknow Hub",
      },
    ],
  }

  it("builds one event with a stable id", () => {
    const parsed = parseShiprocketWebhook(body)!
    expect(parsed.awb).toBe("19041424751540")
    expect(parsed.event.providerStatus).toBe("OUT FOR DELIVERY")
    expect(parsed.event.location).toBe("Lucknow Hub")
    expect(parseShiprocketWebhook(body)!.eventId).toBe(parsed.eventId)
  })

  it("ignores payloads without an AWB, status or time", () => {
    expect(parseShiprocketWebhook({ ...body, awb: "" })).toBeNull()
    expect(
      parseShiprocketWebhook({
        ...body,
        current_timestamp: "",
        scans: [],
      }),
    ).toBeNull()
    expect(parseShiprocketWebhook("nope")).toBeNull()
  })
})

describe("parseShiprocketTracking", () => {
  it("returns the scans oldest first", () => {
    const events = parseShiprocketTracking({
      tracking_data: {
        shipment_track_activities: [
          { date: "2026-10-16 18:00:00", "sr-status-label": "DELIVERED" },
          { date: "2026-10-15 09:00:00", "sr-status-label": "PICKED UP" },
          { date: "bad", "sr-status-label": "IN TRANSIT" },
        ],
      },
    })
    expect(events.map((e) => e.providerStatus)).toEqual([
      "PICKED UP",
      "DELIVERED",
    ])
  })
})
