import type { Metadata, Route } from "next"
import Link from "next/link"
import { Suspense } from "react"

import { AdminPageHeader, NoAccess } from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { ADD_PRODUCT_GUIDE } from "@/features/helper/add-product-guide"
import { can, requireStaff } from "@/features/staff"

import { GuideActions } from "./guide-actions"

export const metadata: Metadata = { title: "How to add a product" }

export default function AddProductGuidePage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Guide />
    </Suspense>
  )
}

async function Guide() {
  const actor = await requireStaff("/admin/help/add-product")
  if (!can(actor, { catalog: ["read"] })) return <NoAccess />
  const guide = ADD_PRODUCT_GUIDE

  return (
    <article className="max-w-3xl">
      <AdminPageHeader
        title={guide.title}
        description={guide.intro}
        actions={
          <GuideActions canCreate={can(actor, { catalog: ["create"] })} />
        }
      />

      <nav
        aria-label="Contents"
        className="mb-8 rounded-sm border bg-card p-4 text-sm print:hidden"
      >
        <p className="mb-2 font-semibold">Contents</p>
        <ol className="flex flex-col gap-1">
          {guide.sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="hover:underline">
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="flex flex-col gap-10">
        {guide.sections.map((section) => (
          <section
            key={section.id}
            id={section.id}
            aria-labelledby={`${section.id}-title`}
            className="scroll-mt-20 break-inside-avoid-page"
          >
            <h2
              id={`${section.id}-title`}
              className="text-xl font-semibold tracking-tight"
            >
              {section.title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {section.intro}
            </p>
            <ol className="mt-4 flex flex-col gap-4">
              {section.steps.map((step, index) => (
                <li key={step.title} className="flex gap-3">
                  <span
                    aria-hidden
                    className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background tabular-nums print:border print:bg-transparent print:text-foreground"
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 break-inside-avoid">
                    <h3 className="font-medium">{step.title}</h3>
                    <p className="mt-0.5 text-sm leading-relaxed">
                      {step.body}
                    </p>
                    {step.where && (
                      <Link
                        href={step.where.href as Route}
                        className="mt-1 inline-block text-sm underline underline-offset-2 print:hidden"
                      >
                        Open {step.where.label} →
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            {section.tip && (
              <p className="mt-4 rounded-sm border-l-2 border-rust bg-card px-3 py-2 text-sm">
                <span className="font-medium">Tip: </span>
                {section.tip}
              </p>
            )}
          </section>
        ))}
      </div>
    </article>
  )
}
