import Link from "next/link"
import { Suspense } from "react"

import { AdminMobileNav } from "@/components/admin/admin-mobile-nav"
import { CommandPalette } from "@/components/admin/command-palette"
import { AdminNavLinks } from "@/components/admin/admin-sidebar"
import { AdminSignOut } from "@/components/admin/sign-out-button"
import { Skeleton } from "@/components/ui/skeleton"
import { ADMIN_NAV, can, requireStaff } from "@/features/staff"

/** The admin shell: the session is read inside Suspense (Cache Components). */
export default function AdminShellLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <Shell>{children}</Shell>
    </Suspense>
  )
}

async function Shell({ children }: { children: React.ReactNode }) {
  const actor = await requireStaff("/admin")
  const groups = ADMIN_NAV.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !item.permission || can(actor, item.permission),
    ),
  })).filter((group) => group.items.length > 0)

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 overflow-y-auto bg-ink p-4 text-paper lg:flex">
        <Link
          href="/admin"
          className="font-display text-2xl tracking-wide uppercase"
        >
          Duis <span className="text-sm text-chrome-muted">admin</span>
        </Link>
        <AdminNavLinks groups={groups} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-card px-4">
          <AdminMobileNav groups={groups} />
          <p className="min-w-0 truncate text-sm text-muted-foreground">
            <span className="hidden sm:inline">Signed in as </span>
            <span className="font-medium text-foreground">
              {actor.roles.join(", ").replace(/_/g, " ")}
            </span>
          </p>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <CommandPalette
              pages={groups.flatMap((group) =>
                group.items.map((item) => ({
                  label: item.label,
                  href: item.href,
                })),
              )}
            />
            <Link
              href="/"
              className="text-sm whitespace-nowrap underline underline-offset-4"
            >
              View store
            </Link>
            <AdminSignOut />
          </div>
        </header>
        <main id="main" className="min-w-0 flex-1 p-4 md:p-6">
          {children}
        </main>
      </div>
    </div>
  )
}

function ShellFallback() {
  return (
    <div className="flex min-h-dvh">
      <div className="hidden w-60 bg-ink lg:block" />
      <div className="flex-1 p-6">
        <Skeleton className="h-8 w-48" />
      </div>
    </div>
  )
}
