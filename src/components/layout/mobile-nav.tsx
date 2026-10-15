"use client"

import { MenuIcon } from "lucide-react"
import type { Route } from "next"
import Link from "next/link"
import { useState } from "react"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import type { ResolvedNavItem } from "@/features/cms"

import { NavBadge } from "./main-nav"

/** Drawer navigation below the `lg` breakpoint. */
export function MobileNav({ items }: { items: ResolvedNavItem[] }) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            className="text-paper hover:bg-white/10 hover:text-paper lg:hidden"
          />
        }
      >
        <MenuIcon className="size-6" />
        <span className="sr-only">Open menu</span>
      </SheetTrigger>
      <SheetContent side="left" className="w-[85vw] gap-0 bg-paper p-0">
        <SheetHeader className="border-b">
          <SheetTitle className="font-display text-2xl tracking-wide uppercase">
            Menu
          </SheetTitle>
        </SheetHeader>
        <nav aria-label="Mobile" className="overflow-y-auto px-4 pb-8">
          <Accordion>
            {items.map((item) =>
              item.children.length > 0 ? (
                <AccordionItem key={item.id} value={item.id}>
                  <AccordionTrigger className="py-4 text-base font-semibold uppercase">
                    {item.label}
                  </AccordionTrigger>
                  <AccordionContent>
                    <ul className="flex flex-col gap-1 pb-2">
                      <li>
                        <DrawerLink href={item.href} onNavigate={close} strong>
                          Shop all {item.label}
                        </DrawerLink>
                      </li>
                      {item.children.map((child) => (
                        <li key={child.id}>
                          <DrawerLink href={child.href} onNavigate={close}>
                            {child.label}
                          </DrawerLink>
                          {child.children.length > 0 && (
                            <ul className="ml-3 border-l pl-3">
                              {child.children.map((grandchild) => (
                                <li key={grandchild.id}>
                                  <DrawerLink
                                    href={grandchild.href}
                                    onNavigate={close}
                                  >
                                    {grandchild.label}
                                  </DrawerLink>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              ) : (
                <div key={item.id} className="border-b">
                  <Link
                    href={item.href as Route}
                    onNavigate={close}
                    className="flex items-center gap-2 py-4 text-base font-semibold uppercase"
                  >
                    {item.label}
                    {item.badge && <NavBadge>{item.badge}</NavBadge>}
                  </Link>
                </div>
              ),
            )}
          </Accordion>
          <ul className="mt-6 flex flex-col gap-1 text-sm">
            <li>
              <DrawerLink href="/account" onNavigate={close}>
                My account
              </DrawerLink>
            </li>
            <li>
              <DrawerLink href="/wishlist" onNavigate={close}>
                Wishlist
              </DrawerLink>
            </li>
          </ul>
        </nav>
      </SheetContent>
    </Sheet>
  )
}

function DrawerLink({
  href,
  onNavigate,
  strong = false,
  children,
}: {
  href: string
  onNavigate: () => void
  strong?: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href as Route}
      onNavigate={onNavigate}
      className={
        strong
          ? "block py-2 font-semibold"
          : "block py-2 text-muted-foreground hover:text-foreground"
      }
    >
      {children}
    </Link>
  )
}
