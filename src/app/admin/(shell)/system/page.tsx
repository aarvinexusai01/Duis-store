import type { Metadata } from "next"
import { Suspense, type ReactNode } from "react"

import {
  AdminPageHeader,
  NoAccess,
  StatusBadge,
} from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { can, requireStaff } from "@/features/staff"
import { getSystemStatus } from "@/features/system"

import { JobActions, WebhookActions } from "./system-actions"

export const metadata: Metadata = { title: "System" }

const when = (date: Date) =>
  date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "Asia/Kolkata",
  })

export default function SystemPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <System />
    </Suspense>
  )
}

async function System() {
  const actor = await requireStaff("/admin/system")
  if (!can(actor, { system: ["read"] })) return <NoAccess />
  const status = await getSystemStatus(actor, {})
  const canOperate = can(actor, { system: ["operate"] })
  const workerOk = status.workerRunning

  return (
    <>
      <AdminPageHeader
        title="System"
        description="Background jobs and incoming webhooks. Jobs retry by themselves; what's listed as failed has used up its retries."
      />
      <div className="flex flex-col gap-6">
        <Panel
          title="Worker"
          action={
            <StatusBadge tone={workerOk ? "good" : "bad"}>
              {workerOk ? "Running" : "Not running"}
            </StatusBadge>
          }
        >
          <p className="text-sm text-muted-foreground">
            {status.heartbeatAt
              ? `Last heartbeat ${when(status.heartbeatAt)}.`
              : "No heartbeat yet."}{" "}
            {!workerOk &&
              "Emails, refunds, parcel bookings and expiries wait until it runs (npm run worker)."}
          </p>
        </Panel>

        <Panel title="Queues">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="py-2 pr-3 font-medium">Queue</th>
                  <th className="py-2 pr-3 text-right font-medium">Waiting</th>
                  <th className="py-2 pr-3 text-right font-medium">
                    Scheduled
                  </th>
                  <th className="py-2 pr-3 text-right font-medium">Running</th>
                  <th className="py-2 text-right font-medium">Failed</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {status.queues.map((q) => (
                  <tr key={q.name}>
                    <td className="py-1.5 pr-3 font-mono text-xs">{q.name}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {q.queued}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {q.deferred}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {q.active}
                    </td>
                    <td
                      className={`py-1.5 text-right tabular-nums ${q.failed > 0 ? "font-semibold text-destructive" : ""}`}
                    >
                      {q.failed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title={`Failed jobs (${status.failed.length})`}>
          {status.failed.length === 0 ? (
            <p className="text-sm text-muted-foreground">None.</p>
          ) : (
            <ul className="divide-y text-sm">
              {status.failed.map((job) => (
                <li
                  key={job.id}
                  className="flex flex-wrap items-start justify-between gap-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="font-mono text-xs">{job.queue}</span>
                    {job.summary && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {job.summary}
                      </span>
                    )}
                    <span className="block break-words text-destructive">
                      {job.error || "No error message."}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {job.retries} retries
                      {job.failedAt && ` · failed ${when(job.failedAt)}`}
                    </span>
                  </span>
                  {canOperate && <JobActions queue={job.queue} id={job.id} />}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Recent webhooks">
          {status.webhooks.length === 0 ? (
            <p className="text-sm text-muted-foreground">None received yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {status.webhooks.map((hook) => (
                <li
                  key={hook.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="font-medium">{hook.provider}</span>{" "}
                    <span className="font-mono text-xs">{hook.type}</span>{" "}
                    <StatusBadge
                      tone={
                        hook.status === "processed"
                          ? "good"
                          : hook.status === "failed"
                            ? "bad"
                            : hook.status === "ignored"
                              ? "neutral"
                              : "warn"
                      }
                    >
                      {hook.status}
                    </StatusBadge>
                    <span className="block text-xs text-muted-foreground">
                      {when(hook.receivedAt)} · {hook.attempts} attempts
                      {hook.error && ` · ${hook.error}`}
                    </span>
                  </span>
                  {canOperate &&
                    ["failed", "received"].includes(hook.status) && (
                      <WebhookActions id={hook.id} />
                    )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  )
}

function Panel({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-sm border bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}
