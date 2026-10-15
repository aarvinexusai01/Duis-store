/** Masks contact details for logs and admin lists (doc/08 §2, telemetry). */

export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@")
  if (!domain) return "***"
  const visible =
    local.length <= 2
      ? `${local[0] ?? ""}*`
      : `${local[0]}${"*".repeat(local.length - 2)}${local.at(-1)}`
  return `${visible}@${domain}`
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  if (digits.length < 6) return "***"
  // E.164 numbers keep their country code (everything before the last 10 digits).
  const countryCode =
    phone.startsWith("+") && digits.length > 10
      ? `+${digits.slice(0, digits.length - 10)}`
      : ""
  return `${countryCode}${"*".repeat(6)}${digits.slice(-4)}`
}
