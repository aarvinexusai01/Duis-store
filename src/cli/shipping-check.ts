import { parseArgs } from "node:util"

import { getServerEnv } from "@/config/env"
import { getShippingProvider } from "@/features/shipping"

/**
 * Checks the live courier account end to end with one test parcel
 * (doc/10 A5), through the same client the shop uses:
 *   ops/compose run --rm --no-deps worker node dist/shipping-check.mjs [--pincode 400001] [--awb]
 *
 * Without --awb it signs in, checks a PIN code, quotes prepaid and COD
 * rates, books a test order and cancels it: free. With --awb it also assigns
 * a courier (Shiprocket takes the freight from the wallet), downloads the
 * label and cancels, which refunds the freight. It never requests a pickup.
 */

type Step = { name: string; run: () => Promise<string> }

async function main() {
  const { values } = parseArgs({
    options: {
      pincode: { type: "string", default: "400001" },
      awb: { type: "boolean", default: false },
    },
  })
  const env = getServerEnv()
  const provider = getShippingProvider()
  if (provider.name !== "shiprocket") {
    console.error(
      `SHIPPING_PROVIDER is ${env.SHIPPING_PROVIDER}, not shiprocket.`,
    )
    process.exitCode = 1
    return
  }
  const pincode = values.pincode!
  let booked: { providerOrderId: string; providerShipmentId: string } | null =
    null
  let awb: string | null = null

  const steps: Step[] = [
    {
      name: "sign in",
      run: async () => {
        await provider.ping()
        return "credentials accepted"
      },
    },
    {
      name: `delivery to ${pincode}`,
      run: async () => {
        const s = await provider.checkServiceability(pincode)
        if (!s.serviceable) throw new Error("not serviceable")
        return `serviceable; COD ${s.codAvailable ? "yes" : "no"}; ${s.eddMinDays}–${s.eddMaxDays} days`
      },
    },
    ...[false, true].map((cod) => ({
      name: `rate, 500 g, ${cod ? "COD" : "prepaid"}`,
      run: async () => {
        const paise = await provider.quoteRate({
          countryCode: "IN",
          pincode,
          weightGrams: 500,
          cod,
        })
        if (paise === null) throw new Error("no rate")
        return `₹${(paise / 100).toFixed(2)}`
      },
    })),
    {
      name: "book a test order",
      run: async () => {
        booked = await provider.createShipment({
          channelOrderId: `DUIS-TEST-${Date.now()}`,
          orderDate: new Date(),
          direction: "forward",
          consignee: {
            name: "Test Customer",
            phone: "+919876543210",
            email: null,
            line1: "Test parcel, please ignore",
            line2: null,
            city: "Mumbai",
            state: "Maharashtra",
            postalCode: pincode,
            countryCode: "IN",
          },
          pickupFrom: null,
          items: [
            {
              name: "Test tee",
              sku: "DUIS-TEST",
              units: 1,
              unitPricePaise: 79_900,
              hsn: "6109",
            },
          ],
          subTotalPaise: 79_900,
          codAmountPaise: 0,
          weightGrams: 500,
          lengthCm: 30,
          breadthCm: 25,
          heightCm: 3,
          customs: null,
        })
        return `order ${booked.providerOrderId}, shipment ${booked.providerShipmentId}`
      },
    },
  ]
  if (values.awb) {
    steps.push(
      {
        name: "assign a courier (AWB)",
        run: async () => {
          const result = await provider.assignAwb(booked!.providerShipmentId)
          awb = result.awb
          return `${result.courierName}, AWB ${result.awb}`
        },
      },
      {
        name: "download the label",
        run: async () => {
          const pdf = await provider.label({
            providerShipmentId: booked!.providerShipmentId,
            awb: awb!,
            courierName: "",
            request: undefined as never,
          })
          return `PDF, ${Math.round(pdf.length / 1024)} KB`
        },
      },
    )
  }

  let failed = false
  for (const step of steps) {
    try {
      console.log(`  ok    ${step.name}: ${await step.run()}`)
    } catch (err) {
      failed = true
      console.log(`  FAIL  ${step.name}: ${(err as Error).message}`)
      break
    }
  }
  if (booked) {
    try {
      await provider.cancel({
        providerOrderId: (booked as { providerOrderId: string })
          .providerOrderId,
        awb,
      })
      console.log("  ok    cancel the test order")
    } catch (err) {
      failed = true
      console.log(
        `  FAIL  cancel the test order: ${(err as Error).message} (cancel it in the Shiprocket panel)`,
      )
    }
  }
  process.exitCode = failed ? 1 : 0
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
