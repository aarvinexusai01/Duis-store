import "server-only"

import { getServerEnv } from "@/config/env"

export type Serviceability = {
  serviceable: boolean
  prepaidAvailable: boolean
  codAvailable: boolean
  eddMinDays: number | null
  eddMaxDays: number | null
}

export interface ShippingProvider {
  readonly name: string
  checkServiceability(pincode: string): Promise<Serviceability>
}

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
}

export function getShippingProvider(): ShippingProvider {
  switch (getServerEnv().SHIPPING_PROVIDER) {
    case "fake":
      return fakeProvider
  }
}
