"use client"

import {
  ActivityIcon,
  ArrowLeftRightIcon,
  BadgePercentIcon,
  BarChart3Icon,
  BanknoteIcon,
  BoxesIcon,
  FolderTreeIcon,
  LayoutDashboardIcon,
  LayersIcon,
  MailIcon,
  PackageIcon,
  RulerIcon,
  ScrollTextIcon,
  SettingsIcon,
  ShieldCheckIcon,
  ShirtIcon,
  StarIcon,
  TagsIcon,
  UsersIcon,
} from "lucide-react"
import type { Route } from "next"
import Link from "next/link"
import { usePathname } from "next/navigation"

import type { AdminNavGroup, AdminNavItem } from "@/features/staff/nav"
import { cn } from "@/lib/utils"

const ICONS: Record<AdminNavItem["icon"], typeof ShirtIcon> = {
  dashboard: LayoutDashboardIcon,
  products: ShirtIcon,
  categories: FolderTreeIcon,
  attributes: TagsIcon,
  sizeCharts: RulerIcon,
  collections: LayersIcon,
  inventory: BoxesIcon,
  orders: PackageIcon,
  cod: BanknoteIcon,
  customers: UsersIcon,
  messages: MailIcon,
  discounts: BadgePercentIcon,
  exchanges: ArrowLeftRightIcon,
  reviews: StarIcon,
  reports: BarChart3Icon,
  staff: ShieldCheckIcon,
  audit: ScrollTextIcon,
  system: ActivityIcon,
  settings: SettingsIcon,
}

export function AdminNavLinks({
  groups,
  onNavigate,
}: {
  groups: AdminNavGroup[]
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  // The most specific link wins (/admin/orders/cod over /admin/orders).
  const current = groups
    .flatMap((group) => group.items.map((item) => item.href))
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0]
  const active = (href: string) => href === current
  return (
    <nav aria-label="Admin" className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="mb-1 px-3 text-[0.6875rem] font-semibold tracking-wider text-chrome-muted uppercase">
            {group.label}
          </p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const Icon = ICONS[item.icon]
              return (
                <li key={item.href}>
                  <Link
                    href={item.href as Route}
                    onNavigate={onNavigate}
                    aria-current={active(item.href) ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-sm px-3 py-2 text-sm",
                      active(item.href)
                        ? "bg-white/10 font-semibold text-paper"
                        : "text-chrome-muted hover:bg-white/5 hover:text-paper",
                    )}
                  >
                    <Icon className="size-4" aria-hidden />
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}
