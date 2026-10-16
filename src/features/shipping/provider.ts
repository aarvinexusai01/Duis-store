import "server-only"

import { getServerEnv } from "@/config/env"
import type { ShipmentCustoms } from "@/db/schema"

import { fakeProvider } from "./fake-provider"
import { shiprocketProvider } from "./shiprocket"

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

export type Consignee = {
  name: string
  phone: string
  email: string | null
  line1: string
  line2: string | null
  city: string
  state: string | null
  postalCode: string
  countryCode: string
}

/** Everything a courier needs to book one parcel. */
export type ShipmentRequest = {
  channelOrderId: string
  orderDate: Date
  consignee: Consignee
  items: {
    name: string
    sku: string
    units: number
    unitPricePaise: number
    hsn: string
  }[]
  /** Value of the goods in the parcel. */
  subTotalPaise: number
  /** Cash the courier collects; 0 for prepaid parcels. */
  codAmountPaise: number
  weightGrams: number
  lengthCm: number
  breadthCm: number
  heightCm: number
  customs: ShipmentCustoms | null
}

export type BookedShipment = {
  providerOrderId: string
  providerShipmentId: string
}

export type LabelRequest = {
  providerShipmentId: string
  awb: string
  courierName: string
  request: ShipmentRequest
}

export type TrackingEvent = {
  providerStatus: string
  occurredAt: Date
  location: string | null
  description: string | null
}

/** The courier boundary (doc/02 §6); one implementation per provider. */
export interface ShippingProvider {
  readonly name: "fake" | "shiprocket"
  checkServiceability(pincode: string): Promise<Serviceability>
  /** The courier's charge in paise, or null when it can't deliver. */
  quoteRate(request: RateRequest): Promise<number | null>
  createShipment(request: ShipmentRequest): Promise<BookedShipment>
  assignAwb(
    providerShipmentId: string,
  ): Promise<{ awb: string; courierName: string }>
  label(request: LabelRequest): Promise<Buffer>
  requestPickup(
    providerShipmentId: string,
  ): Promise<{ scheduledAt: Date | null }>
  /** Cancels a booked parcel before pickup; throws if the courier refuses. */
  cancel(shipment: {
    providerOrderId: string
    awb: string | null
  }): Promise<void>
  /** Every scan the courier has for an AWB (the polling fallback). */
  track(awb: string): Promise<TrackingEvent[]>
}

export function getShippingProvider(): ShippingProvider {
  switch (getServerEnv().SHIPPING_PROVIDER) {
    case "fake":
      return fakeProvider
    case "shiprocket":
      return shiprocketProvider
  }
}
