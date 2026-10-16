import { EmailButton, EmailLayout, EmailText } from "./layout"

export type OrderEmailLine = { title: string; quantity: number; amount: string }

type OrderProps = {
  name: string
  orderNumber: string
  url: string
  total: string
  lines: OrderEmailLine[]
  /** Partial COD: cash still to pay on delivery. */
  codDue?: string
}

function Lines({ lines }: { lines: OrderEmailLine[] }) {
  return (
    <table
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      style={{ margin: "8px 0 16px", fontSize: 14 }}
    >
      <tbody>
        {lines.map((line, index) => (
          <tr key={index}>
            <td style={{ padding: "4px 0" }}>
              {line.title} × {line.quantity}
            </td>
            <td style={{ padding: "4px 0", textAlign: "right" }}>
              {line.amount}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const lineText = (lines: OrderEmailLine[]) =>
  lines.map((l) => `- ${l.title} × ${l.quantity}: ${l.amount}`).join("\n")

export function OrderConfirmedEmail(props: OrderProps) {
  return (
    <EmailLayout preview={`Order ${props.orderNumber} is confirmed.`}>
      <EmailText>Hi {props.name},</EmailText>
      <EmailText>
        Thanks for shopping with Duis. Your order{" "}
        <strong>{props.orderNumber}</strong> is confirmed and we&apos;re getting
        it ready.
      </EmailText>
      <Lines lines={props.lines} />
      <EmailText>
        Total: <strong>{props.total}</strong>
        {props.codDue && (
          <>
            <br />
            To pay in cash on delivery: <strong>{props.codDue}</strong>
          </>
        )}
      </EmailText>
      <EmailButton href={props.url}>View your order</EmailButton>
    </EmailLayout>
  )
}

export function orderConfirmedText(props: OrderProps): string {
  return [
    `Hi ${props.name},`,
    `Your order ${props.orderNumber} is confirmed.`,
    lineText(props.lines),
    `Total: ${props.total}${props.codDue ? `\nTo pay in cash on delivery: ${props.codDue}` : ""}`,
    `View your order: ${props.url}`,
  ].join("\n\n")
}

type CancelProps = {
  name: string
  orderNumber: string
  url: string
  refund?: string
  reason: string
}

export function OrderCancelledEmail(props: CancelProps) {
  return (
    <EmailLayout preview={`Order ${props.orderNumber} was cancelled.`}>
      <EmailText>Hi {props.name},</EmailText>
      <EmailText>
        Your order <strong>{props.orderNumber}</strong> was cancelled:{" "}
        {props.reason}
      </EmailText>
      {props.refund && (
        <EmailText>
          We&apos;re refunding <strong>{props.refund}</strong>. Money paid
          online returns to the original method in 5–7 working days; wallet
          money is back in your wallet now.
        </EmailText>
      )}
      <EmailButton href={props.url}>View your order</EmailButton>
    </EmailLayout>
  )
}

export function orderCancelledText(props: CancelProps): string {
  return [
    `Hi ${props.name},`,
    `Your order ${props.orderNumber} was cancelled: ${props.reason}`,
    props.refund
      ? `We're refunding ${props.refund}. Money paid online returns to the original method in 5–7 working days; wallet money is back in your wallet now.`
      : "",
    `View your order: ${props.url}`,
  ]
    .filter(Boolean)
    .join("\n\n")
}

type RefundProps = {
  name: string
  orderNumber: string
  url: string
  amount: string
  /** Refunded to the Duis wallet rather than the bank. */
  toWallet?: boolean
}

const refundWhere = (props: RefundProps) =>
  props.toWallet
    ? "It's in your Duis wallet now, ready for your next order."
    : "Your bank usually shows it within 5–7 working days."

export function RefundIssuedEmail(props: RefundProps) {
  return (
    <EmailLayout
      preview={`Refund of ${props.amount} for ${props.orderNumber}.`}
    >
      <EmailText>Hi {props.name},</EmailText>
      <EmailText>
        We&apos;ve refunded <strong>{props.amount}</strong> for order{" "}
        {props.orderNumber}. {refundWhere(props)}
      </EmailText>
      <EmailButton href={props.url}>View your order</EmailButton>
    </EmailLayout>
  )
}

export function refundIssuedText(props: RefundProps): string {
  return [
    `Hi ${props.name},`,
    `We've refunded ${props.amount} for order ${props.orderNumber}. ${refundWhere(props)}`,
    `View your order: ${props.url}`,
  ].join("\n\n")
}

type NotCompletedProps = { name: string; orderNumber: string; url: string }

export function OrderNotCompletedEmail(props: NotCompletedProps) {
  return (
    <EmailLayout preview={`Order ${props.orderNumber} wasn't completed.`}>
      <EmailText>Hi {props.name},</EmailText>
      <EmailText>
        We didn&apos;t receive the payment for order {props.orderNumber}, so it
        wasn&apos;t placed and nothing was charged. Your bag still has the items
        if you&apos;d like to try again.
      </EmailText>
      <EmailButton href={props.url}>Back to your bag</EmailButton>
    </EmailLayout>
  )
}

export function orderNotCompletedText(props: NotCompletedProps): string {
  return [
    `Hi ${props.name},`,
    `We didn't receive the payment for order ${props.orderNumber}, so it wasn't placed and nothing was charged. Your bag still has the items if you'd like to try again.`,
    props.url,
  ].join("\n\n")
}

type ShippedProps = {
  name: string
  orderNumber: string
  url: string
  courier: string
  awb: string
  /** Partial COD: cash to pay the courier. */
  codDue?: string
}

export function OrderShippedEmail(props: ShippedProps) {
  return (
    <EmailLayout preview={`Order ${props.orderNumber} is on its way.`}>
      <EmailText>Hi {props.name},</EmailText>
      <EmailText>
        Your order <strong>{props.orderNumber}</strong> is on its way with{" "}
        {props.courier}. Tracking number: <strong>{props.awb}</strong>.
      </EmailText>
      {props.codDue && (
        <EmailText>
          Please keep <strong>{props.codDue}</strong> ready to pay the courier
          on delivery.
        </EmailText>
      )}
      <EmailButton href={props.url}>Track your order</EmailButton>
    </EmailLayout>
  )
}

export function orderShippedText(props: ShippedProps): string {
  return [
    `Hi ${props.name},`,
    `Your order ${props.orderNumber} is on its way with ${props.courier}. Tracking number: ${props.awb}.`,
    ...(props.codDue
      ? [`Please keep ${props.codDue} ready to pay the courier on delivery.`]
      : []),
    `Track your order: ${props.url}`,
  ].join("\n\n")
}
