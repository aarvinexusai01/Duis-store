/** Turns Better Auth client errors into customer-facing text. */
export function authErrorMessage(
  error: { status?: number; code?: string; message?: string } | null,
): string {
  if (!error) return ""
  if (error.status === 429)
    return "Too many attempts. Please wait a minute and try again."
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "That email and password don't match."
    case "EMAIL_NOT_VERIFIED":
      return "Please verify your email first — we've sent you a new link."
    case "INVALID_OTP":
    case "OTP_EXPIRED":
      return "That code is wrong or has expired. Request a new one."
    case "TOO_MANY_ATTEMPTS":
      return "Too many wrong codes. Request a new one."
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "An account with this email already exists. Sign in instead."
    case "PASSWORD_TOO_SHORT":
      return "Use at least 10 characters for your password."
    case "INVALID_TOKEN":
      return "This link has expired. Request a new one."
  }
  return error.message || "Something went wrong. Please try again."
}
