import { JsonLd } from "@/components/json-ld"
import { getStorePolicy } from "@/features/settings"
import { absoluteUrl } from "@/server/site-url"

import { getPublishedSiteSettings } from "../queries"

/**
 * Who sells here (Phase 11): Organization (brand, logo, contact, social
 * profiles and the site-wide return policy, which Google shows as "N-day
 * returns") and WebSite (the site's name in results). Rendered on the home
 * page, from the published site settings and store policy.
 */
export async function SiteStructuredData() {
  const [settings, policy] = await Promise.all([
    getPublishedSiteSettings(),
    getStorePolicy(),
  ])
  const name = settings?.brandName ?? "Duis"
  const url = absoluteUrl("/")
  const sameAs = Object.values(settings?.social ?? {}).filter(Boolean)
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "OnlineStore",
            "@id": `${url}#organization`,
            name,
            url,
            logo: absoluteUrl("/brand/emblem-512.png"),
            ...(settings?.tagline ? { slogan: settings.tagline } : {}),
            ...(sameAs.length > 0 ? { sameAs } : {}),
            ...(settings?.contact
              ? {
                  contactPoint: {
                    "@type": "ContactPoint",
                    contactType: "customer support",
                    email: settings.contact.email,
                    ...(settings.contact.phone
                      ? { telephone: settings.contact.phone }
                      : {}),
                    areaServed: "IN",
                    availableLanguage: ["en", "hi"],
                  },
                }
              : {}),
            // Size and colour exchanges, collected free (doc/01 D6).
            hasMerchantReturnPolicy: {
              "@type": "MerchantReturnPolicy",
              applicableCountry: "IN",
              returnPolicyCategory:
                "https://schema.org/MerchantReturnFiniteReturnWindow",
              merchantReturnDays: policy.exchangeWindowDays,
              returnMethod: "https://schema.org/ReturnByMail",
              returnFees: "https://schema.org/FreeReturn",
              refundType: "https://schema.org/ExchangeRefund",
            },
          },
          {
            "@type": "WebSite",
            "@id": `${url}#website`,
            name,
            url,
            publisher: { "@id": `${url}#organization` },
            inLanguage: "en-IN",
          },
        ],
      }}
    />
  )
}
