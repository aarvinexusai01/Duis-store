import { z } from "zod"

/**
 * Meta's browser cookies, validated before they are stored on an order. A
 * bad value is dropped rather than failing the checkout.
 */
export const marketingContextSchema = z.object({
  fbp: z
    .string()
    .regex(/^fb\.\d\.\d{10,16}\.\d{1,20}$/)
    .optional()
    .catch(undefined),
  fbc: z
    .string()
    .max(500)
    .regex(/^fb\.\d\.\d{10,16}\.[\w-]+$/)
    .optional()
    .catch(undefined),
  userAgent: z.string().max(500).optional().catch(undefined),
})
