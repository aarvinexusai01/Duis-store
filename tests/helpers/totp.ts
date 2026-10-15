import { createHmac } from "node:crypto"

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) — enough to drive 2FA in tests. */
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").toUpperCase()
  let bits = ""
  for (const char of clean) {
    const index = BASE32.indexOf(char)
    if (index === -1) throw new Error("invalid base32")
    bits += index.toString(2).padStart(5, "0")
  }
  const bytes = bits.match(/.{8}/g) ?? []
  return Buffer.from(bytes.map((byte) => parseInt(byte, 2)))
}

export function totp(secret: string, now = Date.now()): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)))
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest()
  const offset = hmac[hmac.length - 1]! & 0x0f
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return String(code).padStart(6, "0")
}

/** The secret from an otpauth:// URI as returned by Better Auth. */
export function secretFromUri(uri: string): string {
  const secret = new URL(uri).searchParams.get("secret")
  if (!secret) throw new Error("no secret in TOTP URI")
  return secret
}
