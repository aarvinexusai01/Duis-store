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
      toWallet: z.boolean().optional(),
    }),
    subject: () => "Your Duis refund is on its way",
  },
  "order-shipped": {
    props: z.object({
      name: z.string().min(1).max(200),
      orderNumber: z.string(),
      url: z.url({ protocol: /^https?$/ }),
      courier: z.string().max(100),
      awb: z.string().max(40),
      codDue: z.string().optional(),
    }),
    subject: () => "Your Duis order has shipped",
  },
  "order-not-completed": {
    props: z.object({
      name: z.string().min(1).max(200),
      orderNumber: z.string(),
      url: z.url({ protocol: /^https?$/ }),
    }),
    subject: () => "Your Duis order wasn't completed",
  },
  "exchange-update": {
    props: z.object({
      name: z.string().min(1).max(200),
      exchangeNumber: z.string(),
      headline: z.string().max(120),
      message: z.string().max(600),
      url: z.url({ protocol: /^https?$/ }),
    }),
    subject: () => "An update on your Duis exchange",
  },
  "review-request": {
    props: z.object({
      name: z.string().min(1).max(200),
      orderNumber: z.string(),
      url: z.url({ protocol: /^https?$/ }),
    }),
    subject: () => "How's the fit? Review your Duis order",
  },
  "staff-invite": {
    props: z.object({
      invitedBy: z.string().min(1).max(200),
      roles: z.string().max(200),
      url: z.url({ protocol: /^https?$/ }),
      expires: z.string().max(100),
    }),
    subject: () => "You're invited to the Duis staff portal",
  },
  "low-stock-digest": {
    props: z.object({
      url: z.url({ protocol: /^https?$/ }),
      total: z.number().int().min(1),
      items: z
        .array(
          z.object({
            title: z.string(),
            sku: z.string(),
            available: z.number().int(),
          }),
        )
        .max(50),
    }),
    subject: () => "Duis: items low on stock",
  },
  "contact-message": {
    props: z.object({
      name: z.string().min(1).max(100),
      email: z.email(),
      phone: z.string().max(20).optional(),
      orderNumber: z.string().max(30).optional(),
      topic: z.string().max(50),
      message: z.string().min(1).max(5000),
      url: z.url({ protocol: /^https?$/ }),
    }),
    subject: () => "New message from the Duis contact form",
  },
  "test-email": {
    props: z.object({ sentBy: z.string().min(1).max(200) }),
    subject: () => "Duis test email",
  },
  "back-in-stock": {
    props: z.object({
      product: z.string().max(200),
      variant: z.string().max(100),
      url: z.url({ protocol: /^https?$/ }),
    }),
    subject: () => "It's back in stock at Duis",
  },
  "cart-reminder": {
    props: z.object({
      name: z.string().min(1).max(200),
      items: z.array(z.string().max(200)).min(1).max(5),
      url: z.url({ protocol: /^https?$/ }),
      unsubscribeUrl: z.url({ protocol: /^https?$/ }),
    }),
    subject: () => "Still thinking it over?",
  },
  "newsletter-confirm": {
    props: z.object({ url: z.url({ protocol: /^https?$/ }) }),
    subject: () => "Confirm your Duis subscription",
  },
} as const

export type EmailTemplateName = keyof typeof emailTemplates

/**
 * Emails staff can turn off (owner decision 2026-10-16), and the setting
 * that controls each. Every other email is always sent.
 */
export const OPTIONAL_EMAILS = {
  "order-shipped": "notify_order_shipped",
  "order-not-completed": "notify_payment_reminder",
  "low-stock-digest": "notify_low_stock",
} as const satisfies Partial<Record<EmailTemplateName, string>>

export type EmailProps<Name extends EmailTemplateName> = z.infer<
  (typeof emailTemplates)[Name]["props"]
>
