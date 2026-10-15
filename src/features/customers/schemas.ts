import { z } from "zod"

import { COUNTRY_CODE_SET } from "@/lib/countries"
import { INDIAN_STATE_CODES } from "@/lib/india"

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined))

/**
 * Country-aware address (ADR-018). Indian addresses need a 6-digit PIN, a
 * state and a 10-digit mobile (stored as +91…); others a postal code and an
 * international number. Mirrors the CHECKs on `addresses`.
 */
export const addressInputSchema = z
  .object({
    id: z.uuid().optional(),
    fullName: z.string().trim().min(2, "Enter the recipient's name.").max(100),
    phone: z.string().trim().max(20),
    line1: z.string().trim().min(3, "Enter the street address.").max(200),
    line2: optionalText(200),
    landmark: optionalText(120),
    city: z.string().trim().min(2, "Enter the city.").max(100),
    region: optionalText(100),
    stateCode: optionalText(8),
    postalCode: z.string().trim().toUpperCase().max(12),
    countryCode: z
      .string()
      .trim()
      .toUpperCase()
      .refine((code) => COUNTRY_CODE_SET.has(code), "Choose a country."),
    type: z.enum(["home", "work", "other"]).default("home"),
    isDefault: z.boolean().default(false),
  })
  .superRefine((address, ctx) => {
    if (address.countryCode === "IN") {
      if (!/^[1-9][0-9]{5}$/.test(address.postalCode)) {
        ctx.addIssue({
          code: "custom",
          path: ["postalCode"],
          message: "Enter a valid 6-digit PIN code.",
        })
      }
      if (!address.stateCode || !INDIAN_STATE_CODES.has(address.stateCode)) {
        ctx.addIssue({
          code: "custom",
          path: ["stateCode"],
          message: "Choose a state.",
        })
      }
      if (!/^(\+91)?[6-9]\d{9}$/.test(address.phone.replace(/[\s-]/g, ""))) {
        ctx.addIssue({
          code: "custom",
          path: ["phone"],
          message: "Enter a 10-digit mobile number.",
        })
      }
    } else {
      if (!/^[A-Z0-9][A-Z0-9 -]{1,10}$/.test(address.postalCode)) {
        ctx.addIssue({
          code: "custom",
          path: ["postalCode"],
          message: "Enter a valid postal code.",
        })
      }
      if (!/^\+[1-9]\d{6,14}$/.test(address.phone.replace(/[\s-]/g, ""))) {
        ctx.addIssue({
          code: "custom",
          path: ["phone"],
          message:
            "Enter the number with its country code, e.g. +44 7700 900123.",
        })
      }
    }
  })
  .transform((address) => {
    const digits = address.phone.replace(/[\s-]/g, "")
    return {
      ...address,
      phone: address.countryCode === "IN" ? `+91${digits.slice(-10)}` : digits,
      stateCode: address.countryCode === "IN" ? address.stateCode : undefined,
      region: address.countryCode === "IN" ? undefined : address.region,
    }
  })

export type AddressInput = z.input<typeof addressInputSchema>

export const profileSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(100),
})

export const consentSchema = z.object({
  marketingEmail: z.boolean(),
  marketingWhatsapp: z.boolean(),
})
