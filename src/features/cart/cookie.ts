/** The guest-cart cookie: a random bearer token (only its hash is stored). */
export const CART_COOKIE = "duis_cart"

export const CART_COOKIE_MAX_AGE = 60 * 60 * 24 * 30

export function cartCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax" as const,
    path: "/",
    maxAge: CART_COOKIE_MAX_AGE,
  }
}
