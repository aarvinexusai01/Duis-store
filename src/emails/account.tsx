import { EmailButton, EmailLayout, EmailText } from "./layout"

type LinkEmailProps = { name: string; url: string }

export function VerifyEmail({ name, url }: LinkEmailProps) {
  return (
    <EmailLayout preview="Confirm your email address to finish setting up your account.">
      <EmailText>Hi {name},</EmailText>
      <EmailText>
        Confirm your email address to finish setting up your Duis account.
      </EmailText>
      <EmailButton href={url}>Confirm email</EmailButton>
      <EmailText>This link expires in 24 hours.</EmailText>
    </EmailLayout>
  )
}

export function verifyEmailText({ name, url }: LinkEmailProps): string {
  return [
    `Hi ${name},`,
    "Confirm your email address to finish setting up your Duis account:",
    url,
    "This link expires in 24 hours.",
  ].join("\n\n")
}

export function ResetPasswordEmail({ name, url }: LinkEmailProps) {
  return (
    <EmailLayout preview="Use this link to choose a new password.">
      <EmailText>Hi {name},</EmailText>
      <EmailText>
        Someone asked to reset the password for your Duis account. Use the
        button below to choose a new one.
      </EmailText>
      <EmailButton href={url}>Choose a new password</EmailButton>
      <EmailText>
        This link expires in 1 hour. If you didn&apos;t ask for this, ignore
        this email — your password won&apos;t change.
      </EmailText>
    </EmailLayout>
  )
}

export function resetPasswordText({ name, url }: LinkEmailProps): string {
  return [
    `Hi ${name},`,
    "Someone asked to reset the password for your Duis account. Choose a new one here:",
    url,
    "This link expires in 1 hour. If you didn't ask for this, ignore this email — your password won't change.",
  ].join("\n\n")
}

export function AccountDeletedEmail({ name }: { name: string }) {
  return (
    <EmailLayout preview="We've deleted your account and personal data.">
      <EmailText>Hi {name},</EmailText>
      <EmailText>
        We&apos;ve deleted your Duis account and personal data, as you asked. We
        keep only the order and tax records the law requires, without your name,
        phone number or street address.
      </EmailText>
    </EmailLayout>
  )
}

export function accountDeletedText({ name }: { name: string }): string {
  return [
    `Hi ${name},`,
    "We've deleted your Duis account and personal data, as you asked. We keep only the order and tax records the law requires, without your name, phone number or street address.",
  ].join("\n\n")
}
