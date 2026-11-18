"use client"

import { PrinterIcon, ShirtIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { startProductWalkthrough } from "@/features/helper/ui/say"

/** "Start the walkthrough" (the helper takes over) and "Print". */
export function GuideActions({ canCreate }: { canCreate: boolean }) {
  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      {canCreate && (
        <Button className="rounded-sm" onClick={startProductWalkthrough}>
          <ShirtIcon aria-hidden />
          Start the walkthrough
        </Button>
      )}
      <Button
        variant="outline"
        className="rounded-sm"
        onClick={() => window.print()}
      >
        <PrinterIcon aria-hidden />
        Print
      </Button>
    </div>
  )
}
