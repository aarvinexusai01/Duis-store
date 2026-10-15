import { EmailButton, EmailLayout, EmailText } from "./layout"

type ConfirmProps = { url: string }

export function NewsletterConfirmEmail({ url }: ConfirmProps) {
  return (
    <EmailLayout preview="Confirm that you want Duis drop alerts and offers.">
      <EmailText>
        Someone (hopefully you) asked to get Duis drop alerts, restocks and
        offers at this address.
      </EmailText>
      <EmailButton href={url}>Yes, subscribe me</EmailButton>
      <EmailText>
        If you didn&apos;t ask for this, ignore this email and you won&apos;t
        hear from us. This link expires in 7 days.
      </EmailText>
    </EmailLayout>
  )
}

export function newsletterConfirmText({ url }: ConfirmProps): string {
  return [
    "Someone (hopefully you) asked to get Duis drop alerts, restocks and offers at this address.",
    `Confirm here: ${url}`,
    "If you didn't ask for this, ignore this email and you won't hear from us. This link expires in 7 days.",
  ].join("\n\n")
}
