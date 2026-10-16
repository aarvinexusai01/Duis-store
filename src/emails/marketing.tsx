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

type BackInStockProps = { product: string; variant: string; url: string }

export function BackInStockEmail(props: BackInStockProps) {
  return (
    <EmailLayout preview={`${props.product} is back in stock.`}>
      <EmailText>
        Good news: <strong>{props.product}</strong>
        {props.variant ? ` in ${props.variant}` : ""} is back in stock. Popular
        sizes go quickly.
      </EmailText>
      <EmailButton href={props.url}>Shop it now</EmailButton>
      <EmailText>
        You asked us to tell you once. This alert is now done; we won&apos;t
        email you about it again.
      </EmailText>
    </EmailLayout>
  )
}

export function backInStockText(props: BackInStockProps): string {
  return [
    `Good news: ${props.product}${props.variant ? ` in ${props.variant}` : ""} is back in stock.`,
    `Shop it now: ${props.url}`,
    "You asked us to tell you once. This alert is now done; we won't email you about it again.",
  ].join("\n\n")
}

type CartReminderProps = {
  name: string
  items: string[]
  url: string
  unsubscribeUrl: string
}

export function CartReminderEmail(props: CartReminderProps) {
  return (
    <EmailLayout preview="Your Duis bag is waiting.">
      <EmailText>Hi {props.name},</EmailText>
      <EmailText>You left a few things in your bag:</EmailText>
      {props.items.map((item) => (
        <EmailText key={item}>• {item}</EmailText>
      ))}
      <EmailButton href={props.url}>Back to your bag</EmailButton>
      <EmailText>
        Prices and stock can change until you check out.{" "}
        <a href={props.unsubscribeUrl}>Stop these emails</a>.
      </EmailText>
    </EmailLayout>
  )
}

export function cartReminderText(props: CartReminderProps): string {
  return [
    `Hi ${props.name},`,
    "You left a few things in your bag:",
    ...props.items.map((item) => `- ${item}`),
    `Back to your bag: ${props.url}`,
    `Prices and stock can change until you check out. Stop these emails: ${props.unsubscribeUrl}`,
  ].join("\n\n")
}
