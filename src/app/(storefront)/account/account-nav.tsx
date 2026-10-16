"use client"

import type { Route } from "next"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"

const LINKS: { href: Route; label: string }[] = [
  { href: "/account", label: "Overview" },
  { href: "/account/orders", label: "Orders" },
  { href: "/account/wallet", label: "Wallet" },
  { href: "/account/profile", label: "Profile" },
  { href: "/account/addresses", label: "Addresses" },
  { href: "/account/security", label: "Security" },
  { href: "/wishlist", label: "Wishlist" },
]

export function AccountNav() {
  const pathname = usePathname()
  const active =
    LINKS.filter((link) =>
      link.href === "/account"
        ? pathname === link.href
        : pathname.startsWith(link.href),
    ).at(-1)?.href ?? null
  return <AccountNavLinks active={active} />
}

export function AccountNavLinks({ active }: { active: string | null }) {
  return (
    <nav aria-label="Account">
      <ul className="flex gap-1 overflow-x-auto lg:flex-col">
        {LINKS.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              aria-current={link.href === active ? "page" : undefined}
              className={cn(
                "block px-3 py-2 text-sm font-semibold tracking-wide whitespace-nowrap uppercase",
                link.href === active
                  ? "bg-ink text-paper"
                  : "hover:bg-secondary",
              )}
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
