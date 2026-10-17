import type { ContactStatus } from "@/features/contact"

export const MESSAGE_STATUS_LABEL: Record<ContactStatus, string> = {
  new: "New",
  replied: "Replied",
  closed: "Closed",
}

export const MESSAGE_STATUS_TONE = {
  new: "warn",
  replied: "good",
  closed: "neutral",
} as const satisfies Record<ContactStatus, string>
