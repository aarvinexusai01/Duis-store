"use client"

import type { Route } from "next"
import Link from "next/link"

import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu"
import { MediaImage } from "@/components/media-image"
import type { ResolvedNavItem } from "@/features/cms"
import { cn } from "@/lib/utils"

const topLevel =
  "h-10 rounded-none bg-transparent px-3 text-sm font-semibold tracking-wide text-paper uppercase hover:bg-white/10 hover:text-paper focus:bg-white/10 focus:text-paper data-popup-open:bg-white/10 data-open:bg-white/10"

/** Desktop mega menu built from the published `header` navigation. */
export function MainNav({ items }: { items: ResolvedNavItem[] }) {
  return (
    <NavigationMenu aria-label="Main" className="hidden lg:flex">
      <NavigationMenuList>
        {items.map((item) =>
          item.children.length > 0 ? (
            <NavigationMenuItem key={item.id}>
              <NavigationMenuTrigger className={topLevel}>
                {item.label}
              </NavigationMenuTrigger>
              <NavigationMenuContent>
                <MegaPanel item={item} />
              </NavigationMenuContent>
            </NavigationMenuItem>
          ) : (
            <NavigationMenuItem key={item.id}>
              <NavigationMenuLink
                render={<Link href={item.href as Route} />}
                className={cn(topLevel, "inline-flex items-center gap-2")}
              >
                {item.label}
                {item.badge && <NavBadge>{item.badge}</NavBadge>}
              </NavigationMenuLink>
            </NavigationMenuItem>
          ),
        )}
      </NavigationMenuList>
    </NavigationMenu>
  )
}

function MegaPanel({ item }: { item: ResolvedNavItem }) {
  const grouped = item.children.some((child) => child.children.length > 0)
  return (
    <div
      className={cn(
        "flex gap-6 p-5",
        grouped
          ? item.promo
            ? "w-[58rem]"
            : "w-[44rem]"
          : item.promo
            ? "w-[30rem]"
            : "w-64",
      )}
    >
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            grouped ? "grid grid-cols-4 gap-x-6 gap-y-4" : "flex flex-col",
          )}
        >
          {item.children.map((child) =>
            grouped ? (
              <div key={child.id} className="flex flex-col gap-1">
                <PanelLink href={child.href} strong>
                  {child.label}
                </PanelLink>
                {child.children.map((grandchild) => (
                  <PanelLink key={grandchild.id} href={grandchild.href}>
                    {grandchild.label}
                  </PanelLink>
                ))}
              </div>
            ) : (
              <PanelLink key={child.id} href={child.href}>
                {child.label}
                {child.badge && <NavBadge>{child.badge}</NavBadge>}
              </PanelLink>
            ),
          )}
        </div>
        <div className="mt-4 border-t pt-3">
          <PanelLink href={item.href} strong>
            Shop all {item.label} →
          </PanelLink>
        </div>
      </div>
      {item.promo && (
        <NavigationMenuLink
          render={<Link href={item.href as Route} />}
          className="relative block w-48 shrink-0 overflow-hidden rounded-none p-0"
        >
          <MediaImage
            media={item.promo}
            alt=""
            fill
            sizes="192px"
            className="object-cover"
          />
          <span className="sr-only">{item.label}</span>
        </NavigationMenuLink>
      )}
    </div>
  )
}

function PanelLink({
  href,
  strong = false,
  children,
}: {
  href: string
  strong?: boolean
  children: React.ReactNode
}) {
  return (
    <NavigationMenuLink
      render={<Link href={href as Route} />}
      className={cn(
        "rounded-none px-2 py-1.5",
        strong ? "font-semibold uppercase" : "text-muted-foreground",
        "hover:text-foreground",
      )}
    >
      {children}
    </NavigationMenuLink>
  )
}

export function NavBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-mustard px-1.5 py-0.5 text-[0.625rem] leading-none font-bold tracking-wider text-ink uppercase">
      {children}
    </span>
  )
}
