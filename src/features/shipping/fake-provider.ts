import "server-only"
import { createHash } from "node:crypto"

import { textPdf } from "@/lib/pdf"
import { formatPaise } from "@/lib/money"

import type { ShippingProvider } from "./provider"

const halfKilos = (grams: number) => Math.max(1, Math.ceil(grams / 500))
const digits = (seed: string, length: number) =>
  BigInt(`0x${createHash("sha256").update(seed).digest("hex").slice(0, 15)}`)
    .toString()
    .padStart(length, "0")
    .slice(-length)

type FakeStep = "create" | "awb" | "label" | "pickup" | "cancel"
let failing: FakeStep | null = null

/** Tests only: make one courier step fail until reset with null. */
export function failFakeShippingStep(step: FakeStep | null): void {
  failing = step
}
function step(name: FakeStep) {
  if (failing === name) throw new Error(`fake courier: ${name} failed`)
}

/**
 * Development stand-in for the courier API. Its answers are fixed rules, not
 * courier data, which is why the environment check forbids it in production
 * (doc/03 §6: delivery estimates are never invented for real customers).
 * Tracking is moved forward by hand from the order page (simulateTracking).
 */
export const fakeProvider: ShippingProvider = {
  name: "fake",
  async checkServiceability(pincode) {
    // 000000–099999 never exist; the 99xxxx band stands in for "unserviceable".
    if (pincode.startsWith("99")) {
      return {
        serviceable: false,
        prepaidAvailable: false,
        codAvailable: false,
        eddMinDays: null,
        eddMaxDays: null,
      }
    }
    // North-east and island PIN bands: prepaid only, longer transit.
    const remote = /^(7[89]|744)/.test(pincode)
    return {
      serviceable: true,
      prepaidAvailable: true,
      codAvailable: !remote,
      eddMinDays: remote ? 6 : 3,
      eddMaxDays: remote ? 9 : 6,
    }
  },
  // Demo rate card: ₹49 for the first 500 g, ₹20 per extra 500 g, ₹30 more
  // for remote PINs; abroad ₹1,500 plus ₹500 per extra 500 g.
  async quoteRate({ countryCode, pincode, weightGrams, cod }) {
    const units = halfKilos(weightGrams)
    if (countryCode !== "IN") return 150_000 + (units - 1) * 50_000
    if (!pincode) return null
    const service = await this.checkServiceability(pincode)
    if (!service.serviceable || (cod && !service.codAvailable)) return null
    const remote = /^(7[89]|744)/.test(pincode)
    return 4_900 + (units - 1) * 2_000 + (remote ? 3_000 : 0)
  },
  async createShipment(request) {
    step("create")
    return {
      providerOrderId: `FAKE-${request.channelOrderId}`,
      providerShipmentId: digits(`shipment:${request.channelOrderId}`, 9),
    }
  },
  async assignAwb(providerShipmentId) {
    step("awb")
    return {
      awb: `FK${digits(`awb:${providerShipmentId}`, 10)}`,
      courierName: "Demo Express",
    }
  },
  async label({ awb, courierName, request }) {
    step("label")
    const to = request.consignee
    return textPdf([
      { text: "DEMO LABEL - NOT FOR SHIPPING", size: 9, bold: true },
      { text: courierName, size: 14, bold: true },
      { text: `AWB ${awb}`, size: 18, bold: true },
      { text: `Order ${request.channelOrderId}` },
      {
        text:
          request.codAmountPaise > 0
            ? `COD: collect ${formatPaise(request.codAmountPaise)}`
            : "PREPAID: collect nothing",
        size: 12,
        bold: true,
      },
      { text: " " },
      { text: "Deliver to:", bold: true },
      { text: to.name },
      { text: to.line1 },
      ...(to.line2 ? [{ text: to.line2 }] : []),
      { text: `${to.city} ${to.postalCode} ${to.countryCode}` },
      { text: `Phone ${to.phone}` },
      { text: " " },
      {
        text: `${request.weightGrams} g, ${request.lengthCm}x${request.breadthCm}x${request.heightCm} cm`,
      },
      ...request.items.map((item) => ({
        text: `${item.units} x ${item.sku}`,
        size: 8,
      })),
    ])
  },
  async requestPickup() {
    step("pickup")
    // Tomorrow at 10:00 IST.
    const next = new Date(Date.now() + 86_400_000)
    next.setUTCHours(4, 30, 0, 0)
    return { scheduledAt: next }
  },
  async cancel() {
    step("cancel")
  },
  async track() {
    return []
  },
}
