import type { Metadata } from "next"

import { AccountNav } from "./account-nav"

export const metadata: Metadata = {
  title: { template: "%s | My account | Duis", default: "My account" },
  robots: { index: false, follow: false },
}

/**
 * Static shell only: each page checks the session inside its own Suspense
 * boundary (and every operation checks it again).
 */
export default function AccountLayout({ children }: LayoutProps<"/account">) {
  return (
    <div className="page-container py-8">
      <h1 className="mb-6 display-heading text-5xl sm:text-6xl">My account</h1>
      <div className="grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <AccountNav />
        <div>{children}</div>
      </div>
    </div>
  )
}
