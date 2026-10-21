"use client"

import { useCallback, useMemo, type ReactNode } from "react"

import type { EditorState } from "@/features/cms"
import {
  siteSettingsDataSchema,
  type SiteSettingsData,
} from "@/features/cms/schemas"

import { MediaField } from "./pickers"
import { useAutosave, type EditorContext } from "./use-autosave"

type Errors = Record<string, string>

const input =
  "h-9 w-full rounded-sm border bg-card px-3 text-sm aria-invalid:border-destructive"

function validate(data: SiteSettingsData): Errors {
  const parsed = siteSettingsDataSchema.safeParse(data)
  if (parsed.success) return {}
  const errors: Errors = {}
  for (const issue of parsed.error.issues) {
    errors[issue.path.join(".")] ??= issue.message.startsWith("Invalid")
      ? issue.path.at(-1) === "email"
        ? "Enter a valid email address."
        : "Check this value."
      : issue.message.startsWith("Too small")
        ? "Fill this in."
        : issue.message
  }
  return errors
}

const optional = (value: string) => (value.trim() ? value : undefined)

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-sm border bg-card p-4 text-sm">
      <legend className="px-1 font-semibold">{title}</legend>
      {children}
    </fieldset>
  )
}

function Text({
  label,
  path,
  value,
  errors,
  onChange,
  maxLength,
  type = "text",
  hint,
}: {
  label: string
  path: string
  value: string | undefined
  errors: Errors
  onChange: (value: string) => void
  maxLength: number
  type?: string
  hint?: string
}) {
  const error = errors[path]
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-medium">{label}</span>
      <input
        type={type}
        value={value ?? ""}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={input}
      />
      {(error ?? hint) && (
        <span
          className={
            error ? "text-xs text-destructive" : "text-xs text-muted-foreground"
          }
        >
          {error ?? hint}
        </span>
      )}
    </label>
  )
}

/** Site settings (doc/06 Phase 6b): brand, contact, social and SEO defaults. */
export function SettingsForm({
  state,
  context,
}: {
  state: EditorState<SiteSettingsData>
  context: EditorContext
}) {
  const countErrors = useCallback(
    (data: SiteSettingsData) => Object.keys(validate(data)).length,
    [],
  )
  const { data, update } = useAutosave<SiteSettingsData>({
    target: { type: "site_settings" },
    state,
    errorCount: countErrors,
    context,
  })
  const errors = useMemo(() => validate(data), [data])
  const count = Object.keys(errors).length
  const set = (patch: Partial<SiteSettingsData>) =>
    update({ ...data, ...patch })
  const officer = data.grievanceOfficer

  return (
    <div className="flex flex-col gap-4">
      {count > 0 && !context.readOnly && (
        <p
          role="alert"
          className="rounded-sm border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          {count} field{count === 1 ? " needs" : "s need"} attention before this
          can be saved.
        </p>
      )}
      <fieldset disabled={context.readOnly} className="flex flex-col gap-4">
        <Section title="Brand">
          <div className="grid gap-3 sm:grid-cols-2">
            <Text
              label="Brand name"
              path="brandName"
              value={data.brandName}
              maxLength={60}
              errors={errors}
              onChange={(brandName) => set({ brandName })}
            />
            <Text
              label="Tagline (optional)"
              path="tagline"
              value={data.tagline}
              maxLength={120}
              errors={errors}
              onChange={(tagline) => set({ tagline: optional(tagline) })}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <MediaField
              label="Logo (shown in the header instead of the wordmark)"
              optional
              value={data.logoMediaId}
              onChange={(logoMediaId) => set({ logoMediaId })}
            />
            <MediaField
              label="Browser tab icon (square)"
              optional
              value={data.faviconMediaId}
              onChange={(faviconMediaId) => set({ faviconMediaId })}
            />
          </div>
        </Section>

        <Section title="Announcement bar">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={data.announcement?.enabled ?? false}
              onChange={(event) =>
                set({
                  announcement: {
                    enabled: event.target.checked,
                    text: data.announcement?.text ?? "",
                    ...(data.announcement?.href
                      ? { href: data.announcement.href }
                      : {}),
                  },
                })
              }
            />
            Show the bar at the top of every page
          </label>
          {data.announcement && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Text
                label="Text"
                path="announcement.text"
                value={data.announcement.text}
                maxLength={140}
                errors={errors}
                onChange={(text) =>
                  set({ announcement: { ...data.announcement!, text } })
                }
              />
              <Text
                label="Link (optional)"
                path="announcement.href"
                value={data.announcement.href}
                maxLength={500}
                hint="A site path like /shop, or an https link."
                errors={errors}
                onChange={(href) =>
                  set({
                    announcement: {
                      ...data.announcement!,
                      href: optional(href),
                    },
                  })
                }
              />
            </div>
          )}
        </Section>

        <Section title="Contact">
          <div className="grid gap-3 sm:grid-cols-2">
            <Text
              label="Email"
              path="contact.email"
              type="email"
              value={data.contact.email}
              maxLength={254}
              errors={errors}
              onChange={(email) => set({ contact: { ...data.contact, email } })}
            />
            <Text
              label="Phone (optional)"
              path="contact.phone"
              value={data.contact.phone}
              maxLength={30}
              errors={errors}
              onChange={(phone) =>
                set({ contact: { ...data.contact, phone: optional(phone) } })
              }
            />
            <Text
              label="Hours (optional)"
              path="contact.hours"
              value={data.contact.hours}
              maxLength={120}
              errors={errors}
              onChange={(hours) =>
                set({ contact: { ...data.contact, hours: optional(hours) } })
              }
            />
            <Text
              label="Address (optional)"
              path="contact.address"
              value={data.contact.address}
              maxLength={300}
              errors={errors}
              onChange={(address) =>
                set({
                  contact: { ...data.contact, address: optional(address) },
                })
              }
            />
          </div>
        </Section>

        <Section title="Social links">
          <div className="grid gap-3 sm:grid-cols-2">
            {(["instagram", "facebook", "youtube", "x"] as const).map(
              (network) => (
                <Text
                  key={network}
                  label={
                    network === "x"
                      ? "X (Twitter)"
                      : network[0]!.toUpperCase() + network.slice(1)
                  }
                  path={`social.${network}`}
                  type="url"
                  value={data.social[network]}
                  maxLength={300}
                  hint="https:// link, or leave empty"
                  errors={errors}
                  onChange={(value) =>
                    set({
                      social: { ...data.social, [network]: optional(value) },
                    })
                  }
                />
              ),
            )}
          </div>
        </Section>

        <Section title="Grievance officer">
          <p className="text-muted-foreground">
            Required on the site by the Consumer Protection (E-Commerce) Rules.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Text
              label="Name"
              path="grievanceOfficer.name"
              value={officer?.name}
              maxLength={100}
              errors={errors}
              onChange={(name) =>
                set({
                  grievanceOfficer:
                    name || officer?.email
                      ? {
                          name,
                          email: officer?.email ?? "",
                          phone: officer?.phone,
                        }
                      : undefined,
                })
              }
            />
            <Text
              label="Email"
              path="grievanceOfficer.email"
              type="email"
              value={officer?.email}
              maxLength={254}
              errors={errors}
              onChange={(email) =>
                set({
                  grievanceOfficer:
                    email || officer?.name
                      ? {
                          name: officer?.name ?? "",
                          email,
                          phone: officer?.phone,
                        }
                      : undefined,
                })
              }
            />
            <Text
              label="Phone (optional)"
              path="grievanceOfficer.phone"
              value={officer?.phone}
              maxLength={30}
              errors={errors}
              onChange={(phone) =>
                officer &&
                set({
                  grievanceOfficer: { ...officer, phone: optional(phone) },
                })
              }
            />
          </div>
        </Section>

        <Section title="Search and sharing defaults">
          <Text
            label="Default page title"
            path="defaultSeo.title"
            value={data.defaultSeo.title}
            maxLength={70}
            errors={errors}
            hint={`${data.defaultSeo.title.length}/70`}
            onChange={(title) =>
              set({ defaultSeo: { ...data.defaultSeo, title } })
            }
          />
          <label className="flex flex-col gap-1.5">
            <span className="font-medium">Default description</span>
            <textarea
              value={data.defaultSeo.description}
              maxLength={170}
              rows={2}
              aria-invalid={errors["defaultSeo.description"] ? true : undefined}
              onChange={(event) =>
                set({
                  defaultSeo: {
                    ...data.defaultSeo,
                    description: event.target.value,
                  },
                })
              }
              className="rounded-sm border bg-card p-2 aria-invalid:border-destructive"
            />
            <span
              className={
                errors["defaultSeo.description"]
                  ? "text-xs text-destructive"
                  : "text-xs text-muted-foreground"
              }
            >
              {errors["defaultSeo.description"] ??
                `${data.defaultSeo.description.length}/170`}
            </span>
          </label>
          <MediaField
            label="Default image when shared"
            optional
            value={data.defaultSeo.ogMediaId}
            onChange={(ogMediaId) =>
              set({ defaultSeo: { ...data.defaultSeo, ogMediaId } })
            }
          />
        </Section>
      </fieldset>
    </div>
  )
}
