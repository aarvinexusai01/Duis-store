import { EmailButton, EmailLayout, EmailText } from "./layout"

type InviteProps = {
  invitedBy: string
  roles: string
  url: string
  expires: string
}

export function StaffInviteEmail(props: InviteProps) {
  return (
    <EmailLayout preview="You're invited to the Duis staff portal.">
      <EmailText>
        {props.invitedBy} invited you to the Duis staff portal as{" "}
        <strong>{props.roles}</strong>.
      </EmailText>
      <EmailButton href={props.url}>Accept the invitation</EmailButton>
      <EmailText>
        You&apos;ll choose a password, then set up two-factor authentication
        with an authenticator app. The link works once and expires on{" "}
        {props.expires}. If you weren&apos;t expecting this, ignore it.
      </EmailText>
    </EmailLayout>
  )
}

export function staffInviteText(props: InviteProps): string {
  return [
    `${props.invitedBy} invited you to the Duis staff portal as ${props.roles}.`,
    `Accept: ${props.url}`,
    `You'll choose a password, then set up two-factor authentication with an authenticator app. The link works once and expires on ${props.expires}. If you weren't expecting this, ignore it.`,
  ].join("\n\n")
}

type LowStockProps = {
  url: string
  total: number
  items: { title: string; sku: string; available: number }[]
}

export function LowStockDigestEmail(props: LowStockProps) {
  return (
    <EmailLayout preview={`${props.total} items are low on stock.`}>
      <EmailText>
        {props.total} item{props.total === 1 ? " is" : "s are"} at or below
        their alert level:
      </EmailText>
      {props.items.map((item) => (
        <EmailText key={item.sku}>
          {item.title} ({item.sku}): <strong>{item.available} left</strong>
        </EmailText>
      ))}
      {props.total > props.items.length && (
        <EmailText>…and {props.total - props.items.length} more.</EmailText>
      )}
      <EmailButton href={props.url}>Open inventory</EmailButton>
    </EmailLayout>
  )
}

export function lowStockDigestText(props: LowStockProps): string {
  return [
    `${props.total} item(s) at or below their alert level:`,
    ...props.items.map(
      (item) => `- ${item.title} (${item.sku}): ${item.available} left`,
    ),
    ...(props.total > props.items.length
      ? [`…and ${props.total - props.items.length} more.`]
      : []),
    `Open inventory: ${props.url}`,
  ].join("\n")
}

type TestProps = { sentBy: string }

export function TestEmail({ sentBy }: TestProps) {
  return (
    <EmailLayout preview="Email from Duis is working.">
      <EmailText>
        This test was sent by {sentBy} from the admin settings. Email delivery
        is working.
      </EmailText>
    </EmailLayout>
  )
}

export function testEmailText({ sentBy }: TestProps): string {
  return `This test was sent by ${sentBy} from the admin settings. Email delivery is working.`
}

type ContactProps = {
  name: string
  email: string
  phone?: string
  orderNumber?: string
  topic: string
  message: string
  url: string
}

function contactDetails(props: ContactProps): string[] {
  return [
    `From: ${props.name} <${props.email}>`,
    ...(props.phone ? [`Phone: ${props.phone}`] : []),
    `Topic: ${props.topic}`,
    ...(props.orderNumber ? [`Order: ${props.orderNumber}`] : []),
  ]
}

export function ContactMessageEmail(props: ContactProps) {
  return (
    <EmailLayout preview={`${props.name}: ${props.message.slice(0, 80)}`}>
      {contactDetails(props).map((line) => (
        <EmailText key={line}>{line}</EmailText>
      ))}
      <p style={{ margin: "0 0 16px", whiteSpace: "pre-wrap" }}>
        {props.message}
      </p>
      <EmailText>
        Reply to this email to answer {props.name} directly, then mark it
        replied in the inbox.
      </EmailText>
      <EmailButton href={props.url}>Open in the inbox</EmailButton>
    </EmailLayout>
  )
}

export function contactMessageText(props: ContactProps): string {
  return [
    contactDetails(props).join("\n"),
    props.message,
    `Reply to this email to answer ${props.name} directly, then mark it replied in the inbox: ${props.url}`,
  ].join("\n\n")
}
