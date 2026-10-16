import type { Metadata } from "next"
import { Suspense } from "react"

import {
  AdminPageHeader,
  NoAccess,
  StatusBadge,
} from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { can, listStaff, requireStaff, ROLE_LABEL } from "@/features/staff"

import { InviteForm, InvitationActions, StaffActions } from "./staff-forms"

export const metadata: Metadata = { title: "Staff" }

const when = (date: Date) =>
  date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  })

export default function StaffPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Staff />
    </Suspense>
  )
}

async function Staff() {
  const actor = await requireStaff("/admin/staff")
  if (!can(actor, { staff: ["read"] })) return <NoAccess />
  const { members, invitations } = await listStaff(actor, {})
  const canManage = can(actor, { staff: ["manage"] })

  return (
    <>
      <AdminPageHeader
        title="Staff"
        description="Everyone with access to this portal. Every staff account needs two-factor authentication."
      />
      <div className="flex flex-col gap-6">
        <div className="grid gap-6 md:grid-cols-2">
          {canManage && <InviteForm />}
          <section className="rounded-sm border bg-card p-4">
            <h2 className="font-semibold">Pending invitations</h2>
            <ul className="mt-2 flex flex-col gap-3 text-sm">
              {invitations.length === 0 && (
                <li className="text-muted-foreground">None.</li>
              )}
              {invitations.map((invitation) => (
                <li key={invitation.id} className="flex justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block break-words">
                      {invitation.email}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {invitation.roles
                        .map((r) => ROLE_LABEL[r] ?? r)
                        .join(", ")}{" "}
                      · expires {when(invitation.expiresAt)}
                    </span>
                  </span>
                  {canManage && <InvitationActions id={invitation.id} />}
                </li>
              ))}
            </ul>
          </section>
        </div>
        <section className="min-w-0 overflow-x-auto rounded-sm border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-secondary/50 text-left text-xs text-muted-foreground uppercase">
              <tr>
                <th className="px-3 py-2 font-medium">Person</th>
                <th className="px-3 py-2 font-medium">Roles</th>
                <th className="px-3 py-2 font-medium">Security</th>
                <th className="px-3 py-2 font-medium">Last active</th>
                {canManage && (
                  <th className="px-3 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y">
              {members.map((member) => (
                <tr
                  key={member.id}
                  className={member.active ? "" : "opacity-60"}
                >
                  <td className="px-3 py-2">
                    <span className="font-medium">{member.name}</span>
                    {member.id === actor.userId && (
                      <span className="text-muted-foreground"> (you)</span>
                    )}
                    <span className="block text-muted-foreground">
                      {member.email}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap gap-1">
                      {member.roles.map((role) => (
                        <StatusBadge key={role}>
                          {ROLE_LABEL[role] ?? role}
                        </StatusBadge>
                      ))}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap gap-1">
                      {member.twoFactorEnabled ? (
                        <StatusBadge tone="good">2FA on</StatusBadge>
                      ) : (
                        <StatusBadge tone="warn">2FA not set up</StatusBadge>
                      )}
                      {!member.active && (
                        <StatusBadge tone="bad">Deactivated</StatusBadge>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {member.lastSeenAt ? when(member.lastSeenAt) : "Never"}
                    {member.sessions > 0 &&
                      ` · ${member.sessions} session${member.sessions === 1 ? "" : "s"}`}
                  </td>
                  {canManage && (
                    <td className="px-3 py-2 text-right">
                      <StaffActions
                        member={member}
                        isSelf={member.id === actor.userId}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </>
  )
}
