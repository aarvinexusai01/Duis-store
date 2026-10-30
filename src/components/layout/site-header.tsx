import { HeartIcon, UserIcon } from "lucide-react"
import type { Route } from "next"
import Link from "next/link"
import { connection } from "next/server"
import { Suspense } from "react"

import { Wordmark } from "@/components/brand/wordmark"
import { buttonVariants } from "@/components/ui/button"
import { HeaderCart } from "@/features/cart/ui/header-cart"
import { CartButton } from "@/features/cart/ui/cart-button"
import { loadCatalogTree, loadMediaRefs } from "@/features/catalog"
import {
  resolveNavigation,
  type NavigationData,
  type SiteSettingsData,
} from "@/features/cms"
import {
  getPublishedSiteSettings,
  getResolvedNavigation,
} from "@/features/cms/queries"
import { cn } from "@/lib/utils"

import { MainNav } from "./main-nav"
import { MobileNav } from "./mobile-nav"
import { MobileSearch } from "./mobile-search"
import { SearchBox } from "./search-box"
import { mediaSrc } from "@/lib/image-loader"

const iconLink = cn(
  buttonVariants({ variant: "ghost", size: "icon-lg" }),
  "text-paper hover:bg-white/10 hover:text-paper",
)

/** Unpublished menus or settings to show instead of the live ones (previews). */
export type ChromeDraft = {
  navigation?: { key: string; data: NavigationData }
  settings?: SiteSettingsData
}

/**
 * Static chrome (wordmark, icons, search) prerenders; the CMS-driven menu,
 * announcement, logo and bag count stream in behind their own boundaries
 * (ADR-016).
 */
export function SiteHeader({ draft }: { draft?: ChromeDraft } = {}) {
  return (
    <>
      {/* Same height before and after it streams in, so nothing shifts. */}
      <Suspense fallback={<div aria-hidden className="h-9 bg-rust" />}>
        <AnnouncementBar draft={draft} />
      </Suspense>
      <header className="sticky top-0 z-40 bg-ink text-paper">
        <div className="page-container flex h-16 items-center gap-1 lg:gap-6">
          <Suspense fallback={<span className="size-9 lg:hidden" />}>
            <NavLoader kind="mobile" draft={draft} />
          </Suspense>
          <Suspense fallback={<Wordmark className="mr-auto lg:mr-0" />}>
            <BrandMark draft={draft} />
          </Suspense>
          <div className="hidden flex-1 lg:flex">
            <Suspense fallback={null}>
              <NavLoader kind="desktop" draft={draft} />
            </Suspense>
          </div>
          <div className="flex items-center gap-0.5">
            <SearchBox className="mr-2 hidden w-64 md:block xl:w-80" />
            <MobileSearch />
            <Link
              href="/wishlist"
              className={cn(iconLink, "hidden sm:inline-flex")}
            >
              <HeartIcon className="size-5" />
              <span className="sr-only">Wishlist</span>
            </Link>
            <Link href="/account" className={iconLink}>
              <UserIcon className="size-5" />
              <span className="sr-only">Account</span>
            </Link>
            <Suspense fallback={<CartButton cart={null} />}>
              <HeaderCart />
            </Suspense>
          </div>
        </div>
      </header>
    </>
  )
}

async function NavLoader({
  kind,
  draft,
}: {
  kind: "desktop" | "mobile"
  draft?: ChromeDraft
}) {
  await connection()
  const override = draft?.navigation?.key === "header" ? draft.navigation : null
  const items = override
    ? await resolveNavigation(override.data, await loadCatalogTree())
    : await getResolvedNavigation("header")
  return kind === "desktop" ? (
    <MainNav items={items} />
  ) : (
    <MobileNav items={items} />
  )
}

/** The logo from site settings, or the text wordmark. */
async function BrandMark({ draft }: { draft?: ChromeDraft }) {
  await connection()
  const settings = draft?.settings ?? (await getPublishedSiteSettings())
  const logo = settings?.logoMediaId
    ? (await loadMediaRefs([settings.logoMediaId])).get(settings.logoMediaId)
    : undefined
  if (!logo) return <Wordmark className="mr-auto lg:mr-0" />
  return (
    <Link href="/" className="mr-auto block h-9 lg:mr-0">
      {/* eslint-disable-next-line @next/next/no-img-element -- small stored rendition */}
      <img
        src={mediaSrc(logo.key, 320)}
        alt={`${settings?.brandName ?? "Duis"} home`}
        className="h-9 w-auto object-contain"
      />
    </Link>
  )
}

async function AnnouncementBar({ draft }: { draft?: ChromeDraft }) {
  await connection()
  const announcement = (draft?.settings ?? (await getPublishedSiteSettings()))
    ?.announcement
  if (!announcement?.enabled) return null
  const text = (
    <p className="truncate text-center text-xs font-semibold tracking-wide sm:text-sm">
      {announcement.text}
    </p>
  )
  return (
    <div className="h-9 bg-rust text-rust-foreground">
      <div className="page-container flex h-full items-center justify-center">
        {announcement.href ? (
          <Link
            href={announcement.href as Route}
            className="block min-w-0 hover:underline"
          >
            {text}
          </Link>
        ) : (
          text
        )}
      </div>
    </div>
  )
}
