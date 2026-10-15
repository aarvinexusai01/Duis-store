"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth-client"
import { authErrorMessage } from "@/lib/auth-errors"

type SessionRow = {
  id: string
  token: string
  userAgent?: string | null
  createdAt: Date
  ipAddress?: string | null
}

export function ChangePasswordForm() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  return (
    <form
      className="flex max-w-md flex-col gap-3"
      onSubmit={async (event) => {
        event.preventDefault()
        const formElement = event.currentTarget
        const form = new FormData(formElement)
        setPending(true)
        setError("")
        const { error } = await authClient.changePassword({
          currentPassword: String(form.get("current")),
          newPassword: String(form.get("new")),
          revokeOtherSessions: true,
        })
        setPending(false)
        if (error) setError(authErrorMessage(error))
        else {
          formElement.reset()
          toast.success("Password changed. Other devices were signed out.")
        }
      }}
    >
      {(
        [
          ["current", "Current password", "current-password"],
          ["new", "New password (10+ characters)", "new-password"],
        ] as const
      ).map(([name, label, autoComplete]) => (
        <div key={name} className="flex flex-col gap-1.5">
          <label htmlFor={`password-${name}`} className="text-sm font-medium">
            {label}
          </label>
          <input
            id={`password-${name}`}
            name={name}
            type="password"
            autoComplete={autoComplete}
            minLength={name === "new" ? 10 : undefined}
            required
            className="h-11 border border-input bg-card px-3 text-base sm:text-sm"
          />
        </div>
      ))}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        type="submit"
        disabled={pending}
        className="h-11 w-fit rounded-none px-6"
      >
        {pending ? "Saving…" : "Change password"}
      </Button>
    </form>
  )
}

export function SessionList() {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null)
  const current = authClient.useSession().data?.session.token

  const load = () =>
    authClient
      .listSessions()
      .then(({ data }) => setSessions((data as SessionRow[] | null) ?? []))
  useEffect(() => {
    load()
  }, [])

  if (!sessions)
    return <p className="text-sm text-muted-foreground">Loading…</p>
  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y border bg-card text-sm">
        {sessions.map((session) => (
          <li
            key={session.id}
            className="flex items-center justify-between gap-4 p-3"
          >
            <span className="min-w-0">
              <span className="line-clamp-1">
                {describeAgent(session.userAgent)}
              </span>
              <span className="text-xs text-muted-foreground">
                Signed in{" "}
                {new Date(session.createdAt).toLocaleDateString("en-IN", {
                  dateStyle: "medium",
                })}
                {session.token === current && " · this device"}
              </span>
            </span>
            {session.token !== current && (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await authClient.revokeSession({ token: session.token })
                  load()
                }}
              >
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>
      {sessions.length > 1 && (
        <Button
          variant="outline"
          className="h-10 w-fit rounded-none"
          onClick={async () => {
            await authClient.revokeOtherSessions()
            load()
            toast.success("Signed out of all other devices")
          }}
        >
          Sign out everywhere else
        </Button>
      )}
    </div>
  )
}

function describeAgent(agent: string | null | undefined): string {
  if (!agent) return "Unknown device"
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /Chrome\//.test(agent)
      ? "Chrome"
      : /Firefox\//.test(agent)
        ? "Firefox"
        : /Safari\//.test(agent)
          ? "Safari"
          : "Browser"
  const os = /Android/.test(agent)
    ? "Android"
    : /iPhone|iPad/.test(agent)
      ? "iOS"
      : /Mac OS X/.test(agent)
        ? "macOS"
        : /Windows/.test(agent)
          ? "Windows"
          : /Linux/.test(agent)
            ? "Linux"
            : ""
  return os ? `${browser} on ${os}` : browser
}

export function SignOutButton() {
  const router = useRouter()
  return (
    <Button
      variant="outline"
      className="h-10 rounded-none"
      onClick={async () => {
        await authClient.signOut()
        router.replace("/")
        router.refresh()
      }}
    >
      Sign out
    </Button>
  )
}
