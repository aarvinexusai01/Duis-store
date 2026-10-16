import "server-only"

import { getServerEnv } from "@/config/env"

export type Serviceability = {
  serviceable: boolean
  prepaidAvailable: boolean
  codAvailable: boolean
  eddMinDays: number | null
  eddMaxDays: number | null
}

export type RateRequest = {
  countryCode: string
  /** India only. */
  pincode: string | null
  weightGrams: number
  cod: boolean
}

export interface ShippingProvider {
  readonly name: string
  checkServiceability(pincode: string): Promise<Serviceability>
  /** The courier's charge in paise, or null when it can't deliver. */
  quoteRate(request: RateRequest): Promise<number | null>
}

const halfKilos = (grams: number) => Math.max(1, Math.ceil(grams / 500))

/**
 * Development stand-in for the courier API. Its answers are fixed rules, not
 * courier data, which is why the environment check forbids it in production
 * (doc/03 §6: delivery estimates are never invented for real customers).
 */
const fakeProvider: ShippingProvider = {
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
}

export function getShippingProvider(): ShippingProvider {
  switch (getServerEnv().SHIPPING_PROVIDER) {
    case "fake":
      return fakeProvider
  }
}
