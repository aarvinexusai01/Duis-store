import { z } from "zod"

const linkProps = z.object({
  name: z.string().min(1).max(200),
  url: z.url({ protocol: /^https?$/ }),
})

/**
 * Every email the platform sends: props schema and subject. Kept free of
 * rendering code so the web process (which only queues emails) never imports
 * react-dom/server; the worker renders them in ./render.tsx.
 */
export const emailTemplates = {
  "verify-email": {
    props: linkProps,
    subject: () => "Confirm your email for Duis",
  },
  "reset-password": {
    props: linkProps,
    subject: () => "Reset your Duis password",
  },
  "order-confirmed": {
    props: z.object({
      name: z.string().min(1).max(200),
      orderNumber: z.string(),
      url: z.url({ protocol: /^https?$/ }),
      total: z.string(),
      codDue: z.string().optional(),
      lines: z
        .array(
          z.object({
            title: z.string(),
            quantity: z.number().int(),
            amount: z.string(),
          }),
        )
        .max(50),
    }),
    subject: () => "Your Duis order is confirmed",
  },
  "order-cancelled": {
    props: z.object({
      name: z.string().min(1).max(200),
      orderNumber: z.string(),
      url: z.url({ protocol: /^https?$/ }),
      reason: z.string().max(300),
      refund: z.string().optional(),
    }),
    subject: () => "Your Duis order was cancelled",
  },
  "refund-issued": {
    props: z.object({
      name: z.string().min(1).max(200),
      orderNumber: z.string(),
      url: z.url({ protocol: /^https?$/ }),
      amount: z.string(),
    }),
    subject: () => "Your Duis refund is on its way",
  },
  "order-not-completed": {
    props: z.object({
      name: z.string().min(1).max(200),
      orderNumber: z.string(),
      url: z.url({ protocol: /^https?$/ }),
    }),
    subject: () => "Your Duis order wasn't completed",
  },
  "newsletter-confirm": {
    props: z.object({ url: z.url({ protocol: /^https?$/ }) }),
    subject: () => "Confirm your Duis subscription",
  },
} as const

export type EmailTemplateName = keyof typeof emailTemplates

export type EmailProps<Name extends EmailTemplateName> = z.infer<
  (typeof emailTemplates)[Name]["props"]
>
