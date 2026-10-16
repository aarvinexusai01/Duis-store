"use client"

import { LogOutIcon } from "lucide-react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth-client"

export function AdminSignOut() {
  const router = useRouter()
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={async () => {
        await authClient.signOut()
        router.replace("/login")
        router.refresh()
      }}
    >
      <LogOutIcon /> Sign out
    </Button>
  )
}
