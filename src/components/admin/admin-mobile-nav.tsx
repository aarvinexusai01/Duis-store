"use client"

import { MenuIcon } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import type { AdminNavGroup } from "@/features/staff/nav"

import { AdminNavLinks } from "./admin-sidebar"

export function AdminMobileNav({ groups }: { groups: AdminNavGroup[] }) {
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="ghost" size="icon" className="lg:hidden" />}
      >
        <MenuIcon />
        <span className="sr-only">Open admin menu</span>
      </SheetTrigger>
      <SheetContent side="left" className="w-72 bg-ink p-4 text-paper">
        <SheetHeader className="px-0">
          <SheetTitle className="text-paper">Duis admin</SheetTitle>
        </SheetHeader>
        <AdminNavLinks groups={groups} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  )
}
