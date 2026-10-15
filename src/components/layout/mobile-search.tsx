"use client"

import { SearchIcon } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"

import { SearchBox } from "./search-box"

export function MobileSearch() {
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon-lg"
            className="text-paper hover:bg-white/10 hover:text-paper md:hidden"
          />
        }
      >
        <SearchIcon className="size-5" />
        <span className="sr-only">Search</span>
      </SheetTrigger>
      <SheetContent side="top" className="bg-paper pb-6">
        <SheetHeader>
          <SheetTitle>Search</SheetTitle>
        </SheetHeader>
        <SearchBox
          autoFocus
          className="mx-4"
          onNavigate={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  )
}
