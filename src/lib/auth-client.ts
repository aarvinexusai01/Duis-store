"use client"

import { phoneNumberClient, twoFactorClient } from "better-auth/client/plugins"
import { createAuthClient } from "better-auth/react"

/**
 * Browser client for /api/auth. Sign-in requests go through the HTTP
 * handler on purpose: that is where Better Auth's rate limits and origin
 * checks run (server-side `auth.api` calls skip them).
 */
export const authClient = createAuthClient({
  plugins: [phoneNumberClient(), twoFactorClient()],
})
