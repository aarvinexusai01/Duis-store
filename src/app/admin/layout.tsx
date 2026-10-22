import type { Metadata } from "next"

export const metadata: Metadata = {
  title: { template: "%s | Duis admin", default: "Duis admin" },
  robots: { index: false, follow: false },
}

export default function AdminRootLayout({ children }: LayoutProps<"/admin">) {
  return (
    // data-admin-shell keeps the browser's scrollbars visible here: wide
    // tables need them (globals.css hides them on the storefront).
    <div
      data-admin-shell
      className="flex min-h-dvh flex-1 flex-col bg-background"
    >
      {children}
    </div>
  )
}
