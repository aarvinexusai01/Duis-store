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
  "newsletter-confirm": {
    props: z.object({ url: z.url({ protocol: /^https?$/ }) }),
    subject: () => "Confirm your Duis subscription",
  },
} as const

export type EmailTemplateName = keyof typeof emailTemplates

export type EmailProps<Name extends EmailTemplateName> = z.infer<
  (typeof emailTemplates)[Name]["props"]
>
