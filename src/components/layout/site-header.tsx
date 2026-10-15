import { HeartIcon, UserIcon } from "lucide-react"
import type { Route } from "next"
import Link from "next/link"
import { connection } from "next/server"
import { Suspense } from "react"

import { Wordmark } from "@/components/brand/wordmark"
import { buttonVariants } from "@/components/ui/button"
import { HeaderCart } from "@/features/cart/ui/header-cart"
import { CartButton } from "@/features/cart/ui/cart-button"
import {
  getPublishedSiteSettings,
  getResolvedNavigation,
} from "@/features/cms/queries"
import { cn } from "@/lib/utils"

import { MainNav } from "./main-nav"
import { MobileNav } from "./mobile-nav"
import { MobileSearch } from "./mobile-search"
import { SearchBox } from "./search-box"

const iconLink = cn(
  buttonVariants({ variant: "ghost", size: "icon-lg" }),
  "text-paper hover:bg-white/10 hover:text-paper",
)

/**
 * Static chrome (wordmark, icons, search) prerenders; the CMS-driven menu,
 * announcement and bag count stream in behind their own boundaries (ADR-016).
 */
export function SiteHeader() {
  return (
    <>
      {/* Same height before and after it streams in, so nothing shifts. */}
      <Suspense fallback={<div aria-hidden className="h-9 bg-rust" />}>
        <AnnouncementBar />
      </Suspense>
      <header className="sticky top-0 z-40 bg-ink text-paper">
        <div className="page-container flex h-16 items-center gap-1 lg:gap-6">
          <Suspense fallback={<span className="size-9 lg:hidden" />}>
            <NavLoader kind="mobile" />
          </Suspense>
          <Wordmark className="mr-auto lg:mr-0" />
          <div className="hidden flex-1 lg:flex">
            <Suspense fallback={null}>
              <NavLoader kind="desktop" />
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

async function NavLoader({ kind }: { kind: "desktop" | "mobile" }) {
  await connection()
  const items = await getResolvedNavigation("header")
  return kind === "desktop" ? (
    <MainNav items={items} />
  ) : (
    <MobileNav items={items} />
  )
}

async function AnnouncementBar() {
  await connection()
  const announcement = (await getPublishedSiteSettings())?.announcement
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
