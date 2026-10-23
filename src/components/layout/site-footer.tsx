import type { Route } from "next"
import Link from "next/link"
import { connection } from "next/server"
import { Suspense } from "react"

import { Wordmark } from "@/components/brand/wordmark"
import { CookieSettingsButton } from "@/features/analytics/ui/cookie-settings-button"
import {
  getPublishedSiteSettings,
  getResolvedNavigation,
} from "@/features/cms/queries"
import { NewsletterForm } from "@/components/newsletter-form"
import { loadCatalogTree } from "@/features/catalog"
import { resolveNavigation } from "@/features/cms"

import type { ChromeDraft } from "./site-header"

export function SiteFooter({ draft }: { draft?: ChromeDraft } = {}) {
  return (
    <footer className="mt-16 bg-ink text-paper">
      <div className="page-container grid gap-12 py-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:py-16">
        <div>
          <Wordmark className="text-5xl" large />
          <h2 className="mt-6 font-display text-2xl tracking-wide uppercase">
            Get first dibs on drops
          </h2>
          <NewsletterForm className="mt-4" />
        </div>
        <Suspense fallback={null}>
          <FooterLinks draft={draft} />
        </Suspense>
      </div>
      <Suspense fallback={null}>
        <FooterLegal draft={draft} />
      </Suspense>
    </footer>
  )
}

async function FooterLinks({ draft }: { draft?: ChromeDraft }) {
  await connection()
  const override = draft?.navigation?.key === "footer" ? draft.navigation : null
  const [columns, settings] = await Promise.all([
    override
      ? loadCatalogTree().then((tree) => resolveNavigation(override.data, tree))
      : getResolvedNavigation("footer"),
    draft?.settings ?? getPublishedSiteSettings(),
  ])
  const social = Object.entries(settings?.social ?? {}).filter(
    (entry): entry is [string, string] => Boolean(entry[1]),
  )
  return (
    <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
      {columns.map((column) => (
        <nav key={column.id} aria-label={column.label}>
          <h2 className="text-sm font-semibold tracking-wider uppercase">
            {column.label}
          </h2>
          <ul className="mt-4 space-y-2 text-sm text-chrome-muted">
            {column.children.map((link) => (
              <li key={link.id}>
                <Link
                  href={link.href as Route}
                  className="hover:text-paper hover:underline"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ))}
      {settings && (
        <div>
          <h2 className="text-sm font-semibold tracking-wider uppercase">
            Contact
          </h2>
          <ul className="mt-4 space-y-2 text-sm text-chrome-muted">
            <li>
              <a
                href={`mailto:${settings.contact.email}`}
                className="break-all hover:text-paper hover:underline"
              >
                {settings.contact.email}
              </a>
            </li>
            {settings.contact.phone && <li>{settings.contact.phone}</li>}
            {settings.contact.hours && <li>{settings.contact.hours}</li>}
            {social.map(([network, href]) => (
              <li key={network}>
                <a
                  href={href}
                  rel="noopener noreferrer"
                  className="capitalize hover:text-paper hover:underline"
                >
                  {network === "x" ? "X (Twitter)" : network}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

async function FooterLegal({ draft }: { draft?: ChromeDraft }) {
  await connection()
  const settings = draft?.settings ?? (await getPublishedSiteSettings())
  const officer = settings?.grievanceOfficer
  return (
    <div className="border-t border-white/10">
      <div className="page-container flex flex-col gap-2 py-6 text-xs text-chrome-muted sm:flex-row sm:justify-between">
        <p>
          © {new Date().getFullYear()} {settings?.brandName ?? "Duis"}. All
          prices in INR, inclusive of all taxes.{" "}
          <CookieSettingsButton className="underline hover:text-paper" />
        </p>
        {officer && (
          <p>
            Grievance officer: {officer.name},{" "}
            <a
              href={`mailto:${officer.email}`}
              className="underline hover:text-paper"
            >
              {officer.email}
            </a>
          </p>
        )}
      </div>
    </div>
  )
}
