import { z } from "zod"

import { slugSchema } from "@/lib/slug-schema"

import { blockSchema, safeHref } from "./blocks"

const id = z.uuid()

export const pageDataSchema = z.object({
  sections: z
    .array(blockSchema)
    .max(40)
    .refine(
      (sections) =>
        new Set(sections.map((section) => section.id)).size === sections.length,
      "Every section needs a unique id.",
    ),
  seo: z
    .object({
      title: z.string().max(70).optional(),
      description: z.string().max(170).optional(),
      ogMediaId: id.optional(),
      noindex: z.boolean().optional(),
      // Another page that should rank instead (duplicates, campaigns).
      canonical: safeHref.optional(),
    })
    .default({}),
})
export type PageData = z.infer<typeof pageDataSchema>

const navLink = z.discriminatedUnion("type", [
  z.object({ type: z.literal("category"), categoryId: id }),
  z.object({ type: z.literal("collection"), collectionId: id }),
  z.object({ type: z.literal("product"), productId: id }),
  z.object({ type: z.literal("page"), slug: slugSchema }),
  z.object({ type: z.literal("url"), href: safeHref }),
])

export type NavItem = {
  id: string
  label: string
  link: z.infer<typeof navLink>
  badge?: string
  promoMediaId?: string
  children?: NavItem[]
}

const navItemSchema: z.ZodType<NavItem> = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(64),
    label: z.string().trim().min(1).max(40),
    link: navLink,
    badge: z.string().trim().max(12).optional(),
    promoMediaId: id.optional(),
    children: z.array(navItemSchema).max(30).optional(),
  }),
)

export const navigationDataSchema = z.object({
  items: z.array(navItemSchema).max(12),
})
export type NavigationData = z.infer<typeof navigationDataSchema>

const httpsUrl = z.url({ protocol: /^https$/ })

export const siteSettingsDataSchema = z.object({
  brandName: z.string().trim().min(1).max(60),
  tagline: z.string().trim().max(120).optional(),
  logoMediaId: id.optional(),
  // Square image for browser tabs; a monogram is used without one.
  faviconMediaId: id.optional(),
  announcement: z
    .object({
      enabled: z.boolean(),
      text: z.string().trim().min(1).max(140),
      href: safeHref.optional(),
    })
    .optional(),
  contact: z.object({
    email: z.email(),
    phone: z.string().max(30).optional(),
    address: z.string().max(300).optional(),
    hours: z.string().max(120).optional(),
  }),
  social: z
    .object({
      instagram: httpsUrl.optional(),
      facebook: httpsUrl.optional(),
      youtube: httpsUrl.optional(),
      x: httpsUrl.optional(),
    })
    .default({}),
  // Required on the site by the Consumer Protection (E-Commerce) Rules.
  grievanceOfficer: z
    .object({
      name: z.string().min(2).max(100),
      email: z.email(),
      phone: z.string().max(30).optional(),
    })
    .optional(),
  defaultSeo: z.object({
    title: z.string().min(1).max(70),
    description: z.string().min(1).max(170),
    ogMediaId: id.optional(),
  }),
})
export type SiteSettingsData = z.infer<typeof siteSettingsDataSchema>

export const createPageSchema = z.object({
  type: z.enum(["home", "landing", "static", "policy"]),
  slug: slugSchema,
  title: z.string().trim().min(1).max(120),
})

export const savePageDraftSchema = z.object({
  pageId: id,
  data: pageDataSchema,
  note: z.string().max(300).optional(),
})

export const saveNavigationDraftSchema = z.object({
  key: z.enum(["header", "footer", "mobile", "social"]),
  name: z.string().trim().min(1).max(60).optional(),
  data: navigationDataSchema,
  note: z.string().max(300).optional(),
})

export const saveSiteSettingsDraftSchema = z.object({
  data: siteSettingsDataSchema,
  note: z.string().max(300).optional(),
})

export const publishRevisionSchema = z.object({ revisionId: id })
