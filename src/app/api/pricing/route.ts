import type { NextRequest } from "next/server"

import { getStorefrontUsdPricing } from "@/features/settings"
import {
  isCrawler,
  visitorCountry,
  visitorPricing,
} from "@/lib/display-currency"

/**
 * The currency to show this visitor (doc/06 Phase 13d): their country from
 * Cloudflare's CF-IPCountry header and the dollar terms for it. Pages stay
 * in rupees for the cache and search engines; the browser converts. The
 * header only changes what is shown: checkout prices by the delivery
 * country.
 */
export async function GET(request: NextRequest) {
  const visitor = {
    country: visitorCountry(request.headers.get("cf-ipcountry")),
    crawler: isCrawler(request.headers.get("user-agent")),
  }
  const body = visitorPricing(await getStorefrontUsdPricing(), visitor)
  return Response.json(body, {
    // Per visitor, never shared; a few minutes saves a request per page.
    headers: { "Cache-Control": "private, max-age=300" },
  })
}
