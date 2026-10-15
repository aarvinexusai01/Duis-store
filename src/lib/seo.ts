import { z } from "zod"

/** SEO overrides shared by products, categories, collections and pages. */
export const seoSchema = z.object({
  seoTitle: z.string().max(70).nullish(),
  seoDescription: z.string().max(170).nullish(),
  noindex: z.boolean().optional(),
})
