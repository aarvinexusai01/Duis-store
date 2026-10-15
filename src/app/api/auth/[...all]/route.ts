import { getAuth } from "@/server/auth/auth"

// Better Auth's endpoints (sign-in, sign-up, OTP, 2FA, sessions, admin).
// The instance is created lazily so the build never needs auth secrets.
export async function GET(request: Request) {
  return getAuth().handler(request)
}

export async function POST(request: Request) {
  return getAuth().handler(request)
}
