import type { Metadata } from "next"

export const metadata: Metadata = {
  title: { template: "%s | Duis admin", default: "Duis admin" },
  robots: { index: false, follow: false },
}

export default function AdminRootLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col bg-background">
      {children}
    </div>
  )
}
