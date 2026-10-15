"use client"

import type { ComponentProps, ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function TextField({
  label,
  hint,
  className,
  id,
  ...input
}: ComponentProps<"input"> & { label: string; hint?: ReactNode; id: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        {...input}
        className="h-11 border border-input bg-card px-3 text-base sm:text-sm"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function SubmitButton({
  pending,
  children,
  pendingLabel = "Please wait…",
}: {
  pending: boolean
  children: ReactNode
  pendingLabel?: string
}) {
  return (
    <Button
      type="submit"
      disabled={pending}
      className="h-12 w-full rounded-none text-sm font-semibold tracking-wider uppercase"
    >
      {pending ? pendingLabel : children}
    </Button>
  )
}

export function FormMessage({
  tone,
  children,
}: {
  tone: "error" | "info"
  children: ReactNode
}) {
  if (!children) return null
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "text-sm",
        tone === "error" ? "font-medium text-destructive" : "text-foreground",
      )}
    >
      {children}
    </p>
  )
}

export { authErrorMessage } from "@/lib/auth-errors"
