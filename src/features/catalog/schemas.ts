import { z } from "zod"

import { richTextSchema } from "@/lib/rich-text"
import { seoSchema } from "@/lib/seo"
import { slugSchema } from "@/lib/slug-schema"

const id = z.uuid()
const name = z.string().trim().min(1).max(120)
const hsnCode = z.string().regex(/^[0-9]{4,8}$/, "HSN codes are 4–8 digits.")
const paise = z.number().int().positive().max(100_000_000)

export const createDepartmentSchema = z.object({
  slug: slugSchema,
  name,
  position: z.number().int().min(0).default(0),
})

export const createCategorySchema = z
  .object({
    departmentId: id,
    parentId: id.nullish(),
    slug: slugSchema,
    name,
    description: z.string().max(2000).nullish(),
    imageMediaId: id.nullish(),
    sizeChartId: id.nullish(),
    defaultHsnCode: hsnCode.nullish(),
    exchangeAllowed: z.boolean().default(true),
    position: z.number().int().min(0).default(0),
  })
  .extend(seoSchema.shape)

export const updateCategorySchema = createCategorySchema
  .omit({ departmentId: true, parentId: true })
  .partial()
  .extend({ id, isActive: z.boolean().optional() })

export const moveCategorySchema = z.object({ id, parentId: id.nullable() })

export const createAttributeSchema = z.object({
  code: slugSchema,
  name,
  kind: z.enum(["swatch", "text"]).default("text"),
  isVariantAxis: z.boolean().default(false),
  isFilterable: z.boolean().default(true),
  position: z.number().int().min(0).default(0),
})

export const createAttributeValueSchema = z.object({
  attributeId: id,
  slug: slugSchema,
  label: name,
  swatchHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullish(),
  filterGroup: slugSchema.nullish(),
  position: z.number().int().min(0).default(0),
})

export const createSizeChartSchema = z.object({
  name,
  unit: z.enum(["in", "cm"]).default("in"),
  chart: z.object({
    columns: z.array(z.string().min(1).max(40)).min(1).max(12),
    rows: z
      .array(
        z.object({
          size: z.string().min(1).max(20),
          values: z.array(z.string().max(20)),
        }),
      )
      .min(1)
      .max(30),
  }),
  howToMeasure: z.string().max(2000).nullish(),
})

const productFields = {
  departmentId: id,
  slug: slugSchema,
  title: z.string().trim().min(2).max(150),
  subtitle: z.string().max(200).nullish(),
  description: richTextSchema.nullish(),
  specifications: z
    .array(
      z.object({
        label: z.string().min(1).max(60),
        value: z.string().min(1).max(300),
      }),
    )
    .max(30)
    .default([]),
  material: z.string().max(200).nullish(),
  care: z.string().max(500).nullish(),
  hsnCode: hsnCode.optional(),
  countryOfOrigin: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .default("IN"),
  manufacturerDetails: z.string().trim().min(5).max(500),
  netQuantity: z.string().min(1).max(40).default("1 N"),
  weightGrams: z.number().int().positive().max(30_000),
  lengthCm: z.number().int().positive().max(300).nullish(),
  breadthCm: z.number().int().positive().max(300).nullish(),
  heightCm: z.number().int().positive().max(300).nullish(),
  tags: z
    .array(z.string().trim().toLowerCase().min(1).max(40))
    .max(30)
    .default([]),
  // First entry is the primary category.
  categoryIds: z.array(id).min(1).max(10),
  // Variant axes in display order, e.g. [colour, size].
  axisAttributeIds: z.array(id).min(1).max(3),
  // Descriptive filter values, e.g. fit=oversized.
  descriptiveValueIds: z.array(id).max(20).default([]),
}

export const createProductSchema = z
  .object(productFields)
  .extend(seoSchema.shape)

export const updateProductSchema = z
  .object(productFields)
  .omit({ departmentId: true, axisAttributeIds: true })
  .partial()
  .extend(seoSchema.shape)
  .extend({ id })

export const generateVariantsSchema = z.object({
  productId: id,
  // One entry per axis; every combination of the listed values is created.
  axes: z
    .array(z.object({ attributeId: id, valueIds: z.array(id).min(1).max(30) }))
    .min(1)
    .max(3),
  pricePaise: paise,
  mrpPaise: paise,
  skuPrefix: z
    .string()
    .regex(/^[A-Z0-9-]{2,30}$/, "Use capital letters, digits and hyphens."),
  initialStock: z.number().int().min(0).max(100_000).default(0),
})

export const updateVariantSchema = z.object({
  id,
  sku: z
    .string()
    .regex(/^[A-Z0-9-]{3,60}$/)
    .optional(),
  barcode: z.string().max(40).nullish(),
  pricePaise: paise.optional(),
  mrpPaise: paise.optional(),
  status: z.enum(["active", "inactive"]).optional(),
  weightGramsOverride: z.number().int().positive().max(30_000).nullish(),
})

export const setProductMediaSchema = z.object({
  productId: id,
  items: z
    .array(
      z.object({
        mediaId: id,
        colorValueId: id.nullish(),
        altOverride: z.string().max(200).nullish(),
      }),
    )
    .max(30),
})

export const productIdSchema = z.object({ id })
