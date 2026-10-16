import type { Metadata } from "next"
import { Suspense } from "react"

import { AdminPageHeader, NoAccess } from "@/components/admin/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { getAdminSettings, getIntegrationHealth } from "@/features/settings"
import { can, requireStaff } from "@/features/staff"

import {
  CodForm,
  IntegrationsPanel,
  LegalForm,
  NotificationsForm,
  PoliciesForm,
  ShippingForm,
  TaxRules,
} from "./settings-forms"

export const metadata: Metadata = { title: "Settings" }

export default function SettingsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Settings />
    </Suspense>
  )
}

async function Settings() {
  const actor = await requireStaff("/admin/settings")
  if (!can(actor, { settings: ["read"] })) return <NoAccess />
  const [settings, health] = await Promise.all([
    getAdminSettings(actor, {}),
    getIntegrationHealth(actor, {}),
  ])
  const canEdit = can(actor, { settings: ["update"] })
  return (
    <>
      <AdminPageHeader
        title="Settings"
        description="Changes apply to new orders. Orders already placed keep their prices, tax and COD terms."
      />
      <nav
        aria-label="Settings sections"
        className="mb-6 flex flex-wrap gap-2 text-sm"
      >
        {[
          ["legal", "Store & legal"],
          ["shipping", "Shipping"],
          ["cod", "Cash on delivery"],
          ["policies", "Policies"],
          ["notifications", "Emails"],
          ["tax", "Tax rules"],
          ["integrations", "Integrations"],
        ].map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="rounded-sm border bg-card px-3 py-1 hover:bg-secondary"
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="flex max-w-3xl flex-col gap-6">
        <LegalForm settings={settings} canEdit={canEdit} />
        <ShippingForm settings={settings} canEdit={canEdit} />
        <CodForm settings={settings} canEdit={canEdit} />
        <PoliciesForm settings={settings} canEdit={canEdit} />
        <NotificationsForm settings={settings} canEdit={canEdit} />
        <TaxRules rules={settings.taxRules} canEdit={canEdit} />
        <IntegrationsPanel health={health} canTest={canEdit} />
      </div>
    </>
  )
}
