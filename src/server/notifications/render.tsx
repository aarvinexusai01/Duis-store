import { renderToStaticMarkup } from "react-dom/server"
import type { ReactElement } from "react"

import {
  ContactMessageEmail,
  contactMessageText,
  LowStockDigestEmail,
  lowStockDigestText,
  StaffInviteEmail,
  staffInviteText,
  TestEmail,
  testEmailText,
} from "@/emails/admin"
import {
  ResetPasswordEmail,
  resetPasswordText,
  VerifyEmail,
  verifyEmailText,
} from "@/emails/account"
import {
  ExchangeUpdateEmail,
  exchangeUpdateText,
  OrderCancelledEmail,
  orderCancelledText,
  OrderConfirmedEmail,
  orderConfirmedText,
  OrderNotCompletedEmail,
  OrderShippedEmail,
  orderNotCompletedText,
  orderShippedText,
  RefundIssuedEmail,
  ReviewRequestEmail,
  reviewRequestText,
  refundIssuedText,
} from "@/emails/orders"
import {
  BackInStockEmail,
  backInStockText,
  CartReminderEmail,
  cartReminderText,
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
  "exchange-update": {
    html: (props) => <ExchangeUpdateEmail {...props} />,
    text: exchangeUpdateText,
  },
  "review-request": {
    html: (props) => <ReviewRequestEmail {...props} />,
    text: reviewRequestText,
  },
  "staff-invite": {
    html: (props) => <StaffInviteEmail {...props} />,
    text: staffInviteText,
  },
  "low-stock-digest": {
    html: (props) => <LowStockDigestEmail {...props} />,
    text: lowStockDigestText,
  },
  "contact-message": {
    html: (props) => <ContactMessageEmail {...props} />,
    text: contactMessageText,
  },
  "test-email": {
    html: (props) => <TestEmail {...props} />,
    text: testEmailText,
  },
  "back-in-stock": {
    html: (props) => <BackInStockEmail {...props} />,
    text: backInStockText,
  },
  "cart-reminder": {
    html: (props) => <CartReminderEmail {...props} />,
    text: cartReminderText,
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
