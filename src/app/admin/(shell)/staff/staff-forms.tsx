"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { StaffMember } from "@/features/staff"
import {
  inviteStaffAction,
  resetStaffTwoFactorAction,
  revokeInvitationAction,
  revokeStaffSessionsAction,
  setStaffActiveAction,
  setStaffRolesAction,
} from "@/features/staff/admin-actions"

// Mirrors ROLE_LABEL in features/staff (kept here: this is a client file).
const ROLES = [
  ["super_admin", "Super Admin", "Everything, including staff"],
  ["store_admin", "Store Admin", "Catalogue, orders, money, settings"],
  ["content_manager", "Content Manager", "Website content, publishes"],
  ["content_editor", "Content Editor", "Website content, drafts only"],
  ["fulfilment_staff", "Fulfilment Staff", "Packing and parcels, no money"],
  ["support_agent", "Support Agent", "Orders, cancellations, customers"],
] as const
type Role = (typeof ROLES)[number][0]

type Result = { ok: boolean; message?: string }
function useAct() {
  const [pending, startTransition] = useTransition()
  const act = (work: () => Promise<Result>, done: string, after?: () => void) =>
    startTransition(async () => {
      const result = await work()
      if (result.ok) {
        toast.success(done)
        after?.()
      } else toast.error(result.message ?? "Something went wrong.")
    })
  return { pending, act }
}

function RolePicker({
  value,
  onChange,
}: {
  value: Set<Role>
  onChange: (next: Set<Role>) => void
}) {
  return (
    <fieldset className="flex flex-col gap-1.5 text-sm">
      <legend className="mb-1">Roles</legend>
      {ROLES.map(([role, label, hint]) => (
        <label key={role} className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={value.has(role)}
            onChange={() => {
              const next = new Set(value)
              if (next.has(role)) next.delete(role)
              else next.add(role)
              onChange(next)
            }}
          />
          <span>
            {label}
            <span className="block text-xs text-muted-foreground">{hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}

export function InviteForm() {
  const [roles, setRoles] = useState<Set<Role>>(new Set())
  const [email, setEmail] = useState("")
  const { pending, act } = useAct()
  return (
    <section className="rounded-sm border bg-card p-4">
      <h2 className="font-semibold">Invite someone</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        They get an email link (valid 72 hours), choose a password and set up
        two-factor.
      </p>
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (roles.size === 0)
            return void toast.error("Choose at least one role.")
          act(
            () => inviteStaffAction({ email, roles: [...roles] }),
            `Invitation sent to ${email}`,
            () => {
              setEmail("")
              setRoles(new Set())
            },
          )
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-9 rounded-sm border border-input bg-paper px-2 text-sm"
          />
        </label>
        <RolePicker value={roles} onChange={setRoles} />
        <Button type="submit" disabled={pending} className="rounded-sm">
          {pending ? "Sending…" : "Send invitation"}
        </Button>
      </form>
    </section>
  )
}

export function InvitationActions({ id }: { id: string }) {
  const { pending, act } = useAct()
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        act(() => revokeInvitationAction(id), "Invitation withdrawn")
      }
    >
      Withdraw
    </Button>
  )
}

export function StaffActions({
  member,
  isSelf,
}: {
  member: StaffMember
  isSelf: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [roles, setRoles] = useState<Set<Role>>(
    new Set(member.roles.filter((r) => r !== "customer") as Role[]),
  )
  const { pending, act } = useAct()
  const confirmThen = (question: string, work: () => void) => {
    if (window.confirm(question)) work()
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              className="rounded-sm"
            />
          }
        >
          Manage
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setEditing(true)}>
            Change roles
          </DropdownMenuItem>
          {!isSelf && member.twoFactorEnabled && (
            <DropdownMenuItem
              onClick={() =>
                confirmThen(
                  `Reset two-factor for ${member.name}? They set it up again at their next sign-in.`,
                  () =>
                    act(
                      () => resetStaffTwoFactorAction(member.id),
                      "Two-factor reset",
                    ),
                )
              }
            >
              Reset two-factor
            </DropdownMenuItem>
          )}
          {member.sessions > 0 && (
            <DropdownMenuItem
              onClick={() =>
                act(
                  () => revokeStaffSessionsAction(member.id),
                  "Signed out everywhere",
                )
              }
            >
              Sign out everywhere
            </DropdownMenuItem>
          )}
          {!isSelf && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() =>
                member.active
                  ? confirmThen(
                      `Deactivate ${member.name}? They are signed out and can't sign in.`,
                      () =>
                        act(
                          () =>
                            setStaffActiveAction({
                              userId: member.id,
                              active: false,
                            }),
                          "Deactivated",
                        ),
                    )
                  : act(
                      () =>
                        setStaffActiveAction({
                          userId: member.id,
                          active: true,
                        }),
                      "Reactivated",
                    )
              }
            >
              {member.active ? "Deactivate" : "Reactivate"}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="bg-paper text-left">
          <DialogHeader>
            <DialogTitle>Roles for {member.name}</DialogTitle>
            <DialogDescription>
              With no roles they become a customer and lose portal access.
            </DialogDescription>
          </DialogHeader>
          <RolePicker value={roles} onChange={setRoles} />
          <Button
            disabled={pending}
            className="rounded-sm"
            onClick={() =>
              act(
                () =>
                  setStaffRolesAction({ userId: member.id, roles: [...roles] }),
                "Roles saved",
                () => setEditing(false),
              )
            }
          >
            Save roles
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
