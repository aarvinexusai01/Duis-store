import { z } from "zod"

/** What the contact form asks about (safe for client import). */
export const CONTACT_TOPICS = {
  order: "An order",
  exchange: "An exchange or return",
  product: "A product or size",
  other: "Something else",
} as const

export type ContactTopic = keyof typeof CONTACT_TOPICS

export const CONTACT_STATUSES = ["new", "replied", "closed"] as const
export type ContactStatus = (typeof CONTACT_STATUSES)[number]

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? undefined : value,
    schema.optional(),
  )

export const contactMessageSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(100),
  email: z.email("Enter a valid email address.").trim().toLowerCase().max(254),
  phone: optional(
    z
      .string()
      .trim()
      .regex(/^\+?[0-9][0-9 -]{6,18}$/, "Enter a valid phone number."),
  ),
  orderNumber: optional(
    z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^DUIS-\d{6,}$/, "Order numbers look like DUIS-100001."),
  ),
  topic: z.enum(
    Object.keys(CONTACT_TOPICS) as [ContactTopic, ...ContactTopic[]],
    "Choose a topic.",
  ),
  message: z
    .string()
    .trim()
    .min(10, "Tell us a little more (at least 10 characters).")
    .max(5000, "Keep it under 5,000 characters."),
})

export type ContactMessageInput = z.input<typeof contactMessageSchema>
