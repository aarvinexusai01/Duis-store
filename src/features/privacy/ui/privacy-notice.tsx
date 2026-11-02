import { Breadcrumbs } from "@/components/breadcrumbs"
import type { SiteSettingsData } from "@/features/cms"
import { NOTICE_VERSION, type NoticeLanguage } from "@/lib/privacy"
import { PRIVACY_NOTICE } from "@/lib/privacy-notice"

const PRIVACY_EMAIL = "privacy@theduis.com"

const Mail = ({ to }: { to: string }) => (
  <a href={`mailto:${to}`} className="underline underline-offset-2">
    {to}
  </a>
)

/** The standalone notice, with contact details from the published settings. */
export function PrivacyNotice({
  language,
  settings,
  path,
}: {
  language: NoticeLanguage
  settings: SiteSettingsData | null
  path: string
}) {
  const t = PRIVACY_NOTICE[language]
  const contact = settings?.contact
  const officer = settings?.grievanceOfficer
  const h2 = "mt-10 mb-3 display-heading text-3xl sm:text-4xl"
  const list = "flex list-disc flex-col gap-2 pl-5"
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex flex-col sm:flex-row sm:gap-2">
      <dt className="font-semibold">{label}:</dt>
      <dd>{value}</dd>
    </div>
  )
  return (
    <article lang={language} className="page-container max-w-3xl py-6 pb-16">
      <Breadcrumbs items={[{ label: t.title, href: path }]} />
      <h1 className="mt-6 display-heading text-5xl sm:text-6xl">{t.title}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {t.version}: {NOTICE_VERSION} ·{" "}
        <a
          href={t.otherLanguage.href}
          lang={language === "en" ? "hi" : "en"}
          className="underline underline-offset-2"
        >
          {t.otherLanguage.label}
        </a>
      </p>
      <p className="mt-6">{t.intro}</p>

      <h2 className={h2}>{t.collect.heading}</h2>
      <ul className="flex flex-col divide-y border-y">
        {t.collect.items.map((item) => (
          <li key={item.name} className="py-4">
            <h3 className="font-semibold">
              {item.name}
              {item.optional && (
                <span className="ml-2 text-xs font-medium text-muted-foreground uppercase">
                  {t.collect.optional}
                </span>
              )}
            </h3>
            <dl className="mt-1 flex flex-col gap-1 text-sm">
              <div>
                <dt className="inline font-medium">{t.collect.what}: </dt>
                <dd className="inline">{item.what}</dd>
              </div>
              <div>
                <dt className="inline font-medium">{t.collect.why}: </dt>
                <dd className="inline">{item.why}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>

      <h2 className={h2}>{t.sharing.heading}</h2>
      <p className="mb-3">{t.sharing.intro}</p>
      <ul className={list}>
        {t.sharing.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="mt-3">{t.sharing.abroad}</p>

      <h2 className={h2}>{t.keeping.heading}</h2>
      <ul className={list}>
        {t.keeping.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <h2 className={h2}>{t.rights.heading}</h2>
      <p className="mb-3">{t.rights.intro}</p>
      <ul className={list}>
        {t.rights.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p className="mt-3">{t.rights.effect}</p>

      <h2 className={h2}>{t.complaints.heading}</h2>
      <p>{t.complaints.grievance}</p>
      {officer && (
        <dl className="my-3 flex flex-col gap-1">
          {row(t.complaints.officer, officer.name)}
          {row(t.contact.email, <Mail to={officer.email} />)}
          {officer.phone && row(t.contact.phone, officer.phone)}
        </dl>
      )}
      <p>{t.complaints.timing}</p>
      <p className="mt-3">{t.complaints.board}</p>

      <h2 className={h2}>{t.children.heading}</h2>
      <p>{t.children.body}</p>

      <h2 className={h2}>{t.contact.heading}</h2>
      <dl className="flex flex-col gap-1">
        {row(t.contact.name, settings?.brandName ?? "Duis")}
        {contact && row(t.contact.support, <Mail to={contact.email} />)}
        {row(t.contact.privacy, <Mail to={PRIVACY_EMAIL} />)}
        {contact?.phone && row(t.contact.phone, contact.phone)}
        {contact?.address && row(t.contact.address, contact.address)}
        {contact?.hours && row(t.contact.hours, contact.hours)}
      </dl>
    </article>
  )
}
