import type { Metadata, Route } from "next"
import Link from "next/link"
import { Suspense } from "react"

import { PageSkeleton } from "@/components/page-skeleton"
import { requireUser } from "@/features/auth/session-guard"
import { getPublishedSiteSettings } from "@/features/cms/queries"
import { DeletionRequest } from "@/features/customers/ui/profile-forms"
import { getPrivacyOverview } from "@/features/privacy/operations"
import { PRIVACY_NOTICE_PATH, PURPOSE_LABEL } from "@/lib/privacy"

import { NomineeForm, WithdrawButton } from "./privacy-forms"

export const metadata: Metadata = { title: "Privacy & data" }

const day = (date: Date) =>
  date.toLocaleDateString("en-IN", {
    dateStyle: "medium",
    timeZone: "Asia/Kolkata",
  })

export default function PrivacyPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Privacy />
    </Suspense>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="border bg-card p-4 text-sm">
      <h2 className="mb-3 text-base font-semibold">{title}</h2>
      {children}
    </section>
  )
}

async function Privacy() {
  const actor = await requireUser("/account/privacy")
  const [overview, settings] = await Promise.all([
    getPrivacyOverview(actor, {}),
    getPublishedSiteSettings(),
  ])
  const officer = settings?.grievanceOfficer
  const link = "underline underline-offset-2"
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Your rights under India&apos;s data protection law. Read the full{" "}
        <Link href={PRIVACY_NOTICE_PATH.en as Route} className={link}>
          Privacy Notice
        </Link>
        .
      </p>

      <Section title="What you've agreed to">
        {overview.consents.length === 0 ? (
          <p className="text-muted-foreground">Nothing recorded yet.</p>
        ) : (
          <ul className="divide-y">
            {overview.consents.map((consent) => (
              <li
                key={consent.purpose}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span>
                  <span className="font-medium">
                    {PURPOSE_LABEL[consent.purpose]}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {consent.granted ? "Agreed" : "Withdrawn"}
                    {consent.at && ` · ${day(consent.at)}`}
                  </span>
                </span>
                {consent.canWithdraw && (
                  <WithdrawButton purpose={consent.purpose as never} />
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Your account and orders can&apos;t be withdrawn on their own: we need
          them to serve you and the law requires order records. To end them,
          delete your account below.
        </p>
        {overview.history.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer font-medium">
              Full history
            </summary>
            <ul className="mt-2 flex flex-col gap-1 text-xs">
              {overview.history.map((row, index) => (
                <li key={index}>
                  {day(row.at)}: {row.granted ? "Agreed to" : "Withdrew"}{" "}
                  {PURPOSE_LABEL[row.purpose]} (notice {row.noticeVersion},{" "}
                  {row.language === "hi" ? "Hindi" : "English"})
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>

      <Section title="Get a copy of your data">
        <p className="mb-3">
          A file with your account, addresses, orders, exchanges, reviews,
          messages, wallet history and consents.
        </p>
        {/* A file, not a page. */}
        <a href="/account/privacy/download" className={`font-medium ${link}`}>
          Download my data
        </a>
      </Section>

      <Section title="Correct your details">
        <p>
          Change them in{" "}
          <Link href="/account/profile" className={link}>
            Profile
          </Link>{" "}
          and{" "}
          <Link href="/account/addresses" className={link}>
            Addresses
          </Link>
          .
        </p>
      </Section>

      <Section title="Your nominee">
        <p className="mb-3">
          Someone who can use these rights for you if you die or can&apos;t act
          yourself.
        </p>
        <NomineeForm nominee={overview.nominee} />
      </Section>

      <Section title="Delete your account">
        <DeletionRequest requestedAt={overview.deletionRequestedAt} />
      </Section>

      {officer && (
        <Section title="Complain">
          <p>
            Write to our Grievance Officer, {officer.name}, at{" "}
            <a href={`mailto:${officer.email}`} className={link}>
              {officer.email}
            </a>
            . If you aren&apos;t satisfied, you can complain to the Data
            Protection Board of India.
          </p>
        </Section>
      )}
    </div>
  )
}
