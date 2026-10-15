import type { MetadataRoute } from "next"
import { connection } from "next/server"

import { getServerEnv } from "@/config/env"
import { absoluteUrl } from "@/server/site-url"

export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection()
  // Only production is indexable; staging and development ask crawlers to stay out.
  if (getServerEnv().APP_ENV !== "production") {
    return { rules: { userAgent: "*", disallow: "/" } }
  }
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/account",
        "/cart",
        "/wishlist",
        "/search",
        "/login",
        "/register",
        "/auth/",
        "/api/",
        "/admin",
        "/newsletter/",
      ],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  }
}
