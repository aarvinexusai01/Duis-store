"use client"

import { ShoppingBagIcon } from "lucide-react"
import Link from "next/link"

import { SHOP_HREF } from "@/config/routes"

import { Button, buttonVariants } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

import type { CartView } from "../service"
import { CartLines } from "./cart-lines"
import { CartSummary } from "./cart-summary"
import { setCartDrawerOpen, useCartDrawerOpen } from "./drawer-store"

const iconButton =
  "relative text-paper hover:bg-white/10 hover:text-paper aria-expanded:bg-white/10 aria-expanded:text-paper"

/** Header bag icon with the item count; opens the cart drawer. */
export function CartButton({ cart }: { cart: CartView | null }) {
  const open = useCartDrawerOpen()
  const count = cart?.itemCount ?? 0
  const close = () => setCartDrawerOpen(false)

  return (
    <Sheet open={open} onOpenChange={setCartDrawerOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon-lg" className={iconButton} />
        }
      >
        <ShoppingBagIcon className="size-5" />
        {count > 0 && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-rust px-1 text-[0.625rem] font-bold text-white tabular-nums"
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
        <span className="sr-only">
          Bag, {count} {count === 1 ? "item" : "items"}
        </span>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 bg-paper p-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle className="font-display text-2xl tracking-wide uppercase">
            Your bag {count > 0 && `(${count})`}
          </SheetTitle>
        </SheetHeader>
        {cart && cart.lines.length > 0 ? (
          <>
            <div className="flex-1 overflow-y-auto px-4">
              <CartLines lines={cart.lines} compact onNavigate={close} />
            </div>
            <SheetFooter className="border-t bg-card">
              <CartSummary cart={cart} />
              <Link
                href="/cart"
                onNavigate={close}
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "h-12 w-full rounded-none text-sm font-semibold tracking-wide uppercase",
                )}
              >
                View bag &amp; checkout
              </Link>
            </SheetFooter>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
            <ShoppingBagIcon className="size-10 text-muted-foreground" />
            <p className="font-medium">Your bag is empty.</p>
            <Link
              href={SHOP_HREF}
              onNavigate={close}
              className={cn(buttonVariants(), "rounded-none px-6")}
            >
              Start shopping
            </Link>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
