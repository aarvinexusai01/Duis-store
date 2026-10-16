import { renderToStaticMarkup } from "react-dom/server"
import type { ReactElement } from "react"

import {
  ResetPasswordEmail,
  resetPasswordText,
  VerifyEmail,
  verifyEmailText,
} from "@/emails/account"
import {
  OrderCancelledEmail,
  orderCancelledText,
  OrderConfirmedEmail,
  orderConfirmedText,
  OrderNotCompletedEmail,
  OrderShippedEmail,
  orderNotCompletedText,
  orderShippedText,
  RefundIssuedEmail,
  refundIssuedText,
} from "@/emails/orders"
import {
  NewsletterConfirmEmail,
  newsletterConfirmText,
} from "@/emails/marketing"

import {
  emailTemplates,
  type EmailProps,
  type EmailTemplateName,
} from "./templates"

/** Worker-only: turns a template and its props into a sendable email. */
const views: {
  [Name in EmailTemplateName]: {
    html(props: EmailProps<Name>): ReactElement
    text(props: EmailProps<Name>): string
  }
} = {
  "verify-email": {
    html: (props) => <VerifyEmail {...props} />,
    text: verifyEmailText,
  },
  "reset-password": {
    html: (props) => <ResetPasswordEmail {...props} />,
    text: resetPasswordText,
  },
  "order-confirmed": {
    html: (props) => <OrderConfirmedEmail {...props} />,
    text: orderConfirmedText,
  },
  "order-cancelled": {
    html: (props) => <OrderCancelledEmail {...props} />,
    text: orderCancelledText,
  },
  "refund-issued": {
    html: (props) => <RefundIssuedEmail {...props} />,
    text: refundIssuedText,
  },
  "order-not-completed": {
    html: (props) => <OrderNotCompletedEmail {...props} />,
    text: orderNotCompletedText,
  },
  "order-shipped": {
    html: (props) => <OrderShippedEmail {...props} />,
    text: orderShippedText,
  },
  "newsletter-confirm": {
    html: (props) => <NewsletterConfirmEmail {...props} />,
    text: newsletterConfirmText,
  },
}

export type RenderedEmail = { subject: string; html: string; text: string }

export function renderEmail(
  name: EmailTemplateName,
  rawProps: unknown,
): RenderedEmail {
  const props = emailTemplates[name].props.parse(rawProps)
  // `props` was parsed by this template's own schema, so it matches its view.
  const view = views[name] as {
    html(props: unknown): ReactElement
    text(props: unknown): string
  }
  return {
    subject: emailTemplates[name].subject(),
    html: `<!DOCTYPE html>${renderToStaticMarkup(view.html(props))}`,
    text: view.text(props),
  }
}
