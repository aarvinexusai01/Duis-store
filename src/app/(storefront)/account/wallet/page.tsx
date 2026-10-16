import type { Metadata } from "next"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/page-skeleton"
import { requireUser } from "@/features/auth/session-guard"
import { getWalletSummary } from "@/features/wallet"
import { formatPaise } from "@/lib/money"
import { WALLET_REASON_LABEL as REASON } from "@/lib/wallet-reasons"

export const metadata: Metadata = { title: "Wallet" }

export default function WalletPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Wallet />
    </Suspense>
  )
}

async function Wallet() {
  const actor = await requireUser("/account/wallet")
  const wallet = await getWalletSummary(actor, {})
  const date = (d: Date) =>
    d.toLocaleDateString("en-IN", {
      dateStyle: "medium",
      timeZone: "Asia/Kolkata",
    })
  return (
    <section className="flex flex-col gap-6">
      <div className="border bg-card p-6">
        <p className="text-sm text-muted-foreground">Available balance</p>
        <p className="font-display text-5xl">
          {formatPaise(wallet.balancePaise)}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Use it at checkout. Promotional credit expires on the date shown;
          refunded money never expires.
        </p>
      </div>
      {wallet.expiring.length > 0 && (
        <div>
          <h2 className="mb-2 font-semibold">Expiring soon</h2>
          <ul className="space-y-1 text-sm">
            {wallet.expiring.map((lot, index) => (
              <li key={index}>
                {formatPaise(lot.amountPaise)} expires on {date(lot.expiresAt)}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h2 className="mb-2 font-semibold">History</h2>
        {wallet.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No wallet activity yet.
          </p>
        ) : (
          <ul className="divide-y border bg-card text-sm">
            {wallet.entries.map((entry) => (
              <li key={entry.id} className="flex justify-between gap-4 p-3">
                <span>
                  {REASON[entry.reason] ?? entry.reason}
                  {entry.note && (
                    <span className="block text-xs text-muted-foreground">
                      {entry.note}
                    </span>
                  )}
                  <span className="block text-xs text-muted-foreground">
                    {date(entry.createdAt)}
                  </span>
                </span>
                <span
                  className={`tabular-nums ${entry.amountPaise > 0 ? "text-emerald-800" : ""}`}
                >
                  {entry.amountPaise > 0 ? "+" : "−"}
                  {formatPaise(Math.abs(entry.amountPaise))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
