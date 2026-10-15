import { z } from "zod"

const id = z.uuid()

export const createStockLocationSchema = z.object({
  code: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().trim().min(2).max(120),
  addressLine1: z.string().trim().min(5).max(300),
  city: z.string().trim().min(2).max(100),
  stateCode: z
    .string()
    .regex(/^IN-[A-Z]{2}$/, "Use an ISO 3166-2:IN code, e.g. IN-MH."),
  postalCode: z.string().regex(/^[1-9][0-9]{5}$/),
  shiprocketPickupCode: z.string().max(100).nullish(),
  isDefault: z.boolean().default(false),
})

export const adjustStockSchema = z.object({
  variantId: id,
  locationId: id.optional(),
  delta: z
    .number()
    .int()
    .refine((value) => value !== 0, "The change cannot be zero.")
    .refine((value) => Math.abs(value) <= 100_000, "That change is too large."),
  reason: z.enum(["receive", "adjust", "damaged", "count_correction"]),
  note: z.string().trim().max(500).optional(),
})

export const setLowStockThresholdSchema = z.object({
  variantId: id,
  locationId: id.optional(),
  threshold: z.number().int().min(0).max(10_000),
})

export const availabilitySchema = z.object({
  variantIds: z.array(id).min(1).max(200),
})
