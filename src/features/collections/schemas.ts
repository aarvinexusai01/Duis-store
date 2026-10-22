import { z } from "zod"

import { expectedVersionField } from "@/lib/version"

import { seoSchema } from "@/lib/seo"
import { slugSchema } from "@/lib/slug-schema"

const id = z.uuid()

export const collectionRuleSchema = z.discriminatedUnion("field", [
  z.object({
    field: z.literal("price"),
    operator: z.enum(["lte", "gte"]),
    valuePaise: z.number().int().positive(),
  }),
  z.object({
    field: z.literal("category"),
    categoryIds: z.array(id).min(1).max(20),
  }),
  z.object({
    field: z.literal("tag"),
    tags: z.array(z.string().trim().toLowerCase().min(1)).min(1).max(20),
  }),
  z.object({
    field: z.literal("created_within_days"),
    days: z.number().int().min(1).max(365),
  }),
  z.object({
    field: z.literal("attribute_value"),
    attributeValueIds: z.array(id).min(1).max(20),
  }),
  z.object({
    field: z.literal("best_selling"),
    top: z.number().int().min(1).max(200),
  }),
])

export type CollectionRuleInput = z.infer<typeof collectionRuleSchema>

const collectionFields = {
  slug: slugSchema,
  title: z.string().trim().min(2).max(120),
  description: z.string().max(2000).nullish(),
  imageMediaId: id.nullish(),
  bannerMediaId: id.nullish(),
  sortMode: z
    .enum(["manual", "best_selling", "newest", "price_asc", "price_desc"])
    .default("manual"),
}

export const createCollectionSchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("manual"), ...collectionFields }),
    z.object({
      type: z.literal("automatic"),
      ...collectionFields,
      rules: z.array(collectionRuleSchema).min(1).max(10),
      ruleMatch: z.enum(["all", "any"]).default("all"),
    }),
  ])
  .and(seoSchema)

export const updateCollectionSchema = z
  .object({
    id,
    ...collectionFields,
    rules: z.array(collectionRuleSchema).min(1).max(10),
    ruleMatch: z.enum(["all", "any"]),
  })
  .partial()
  .required({ id: true })
  .extend(seoSchema.shape)
  .extend({ expectedVersion: expectedVersionField })

export const setCollectionProductsSchema = z.object({
  collectionId: id,
  productIds: z.array(id).max(500),
  expectedVersion: expectedVersionField,
})

export const collectionIdSchema = z.object({ id })
