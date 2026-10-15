import { renderToStaticMarkup } from "react-dom/server"
import type { ReactElement } from "react"

import {
  ResetPasswordEmail,
  resetPasswordText,
  VerifyEmail,
  verifyEmailText,
} from "@/emails/account"

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
}

export type RenderedEmail = { subject: string; html: string; text: string }

export function renderEmail(
  name: EmailTemplateName,
  rawProps: unknown,
): RenderedEmail {
  const props = emailTemplates[name].props.parse(rawProps)
  const view = views[name]
  return {
    subject: emailTemplates[name].subject(),
    html: `<!DOCTYPE html>${renderToStaticMarkup(view.html(props))}`,
    text: view.text(props),
  }
}
