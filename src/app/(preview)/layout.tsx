import type { Metadata } from "next"

export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

/**
 * Draft previews (doc/06 Phase 6): the page draws the storefront header and
 * footer itself (a menu or settings draft replaces the live one), with no
 * analytics or consent banner, so previews never count as visits.
 */
export default function PreviewLayout({ children }: LayoutProps<"/">) {
  return children
}
