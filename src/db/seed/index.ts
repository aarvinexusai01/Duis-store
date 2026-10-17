import { eq } from "drizzle-orm"

import { getServerEnv } from "@/config/env"
import { departments, users } from "@/db/schema"
import {
  createAttribute,
  createAttributeValue,
  createCategory,
  createDepartment,
  createProduct,
  createSizeChart,
  generateVariants,
  publishProduct,
  setProductMedia,
} from "@/features/catalog"
import {
  createPage,
  publishRevision,
  saveNavigationDraft,
  savePageDraft,
  saveSiteSettingsDraft,
} from "@/features/cms"
import {
  createCollection,
  publishCollection,
  setCollectionProducts,
} from "@/features/collections"
import { adjustStock, createStockLocation } from "@/features/inventory"
import { uploadImage } from "@/features/media"
import { paragraphs } from "@/lib/rich-text"
import { systemActor } from "@/server/auth/actor"
import { getAuth } from "@/server/auth/auth"
import { STAFF_ROLES } from "@/server/auth/roles"
import { createDiscount } from "@/features/discounts"
import { suppressRevalidation } from "@/server/cache/revalidate"
import { closeDb, getDb } from "@/server/db/client"
import { createBoss } from "@/server/jobs/boss"
import { stopSender } from "@/server/jobs/enqueue"
import { ensureQueues } from "@/server/jobs/queues"

import {
  footerNavigation,
  FAQ,
  headerNavigation,
  homepage,
  siteSettings,
  STATIC_PAGES,
} from "./content"
import {
  ALPHA_SIZES,
  CATEGORY_TREE,
  COLOURS,
  DESCRIPTIVE,
  PRODUCT_GROUPS,
  SIZE_CHARTS,
  WAIST_SIZES,
} from "./data"
import { bannerImage, garmentImage } from "./images"
import { bannerPhoto, productPhotos } from "./photos"

/**
 * Deterministic demo data for development (doc/06 Phase 1, task 10):
 *   npm run db:seed
 * Refuses to run against staging or production, and refuses to run twice.
 */

const DEV_PASSWORD = "Duis-dev-Passw0rd!"
const SKU_CODES: Record<string, string> = {
  "oversized-t-shirts": "OVS",
  "regular-fit-t-shirts": "RFT",
  "graphic-t-shirts": "GRT",
  "polo-t-shirts": "POL",
  "casual-shirts": "CSH",
  "linen-shirts": "LSH",
  overshirts: "OSH",
  hoodies: "HOD",
  sweatshirts: "SWT",
  jeans: "JNS",
  trousers: "TRS",
  shorts: "SHO",
  joggers: "JOG",
}

/** Small seeded PRNG (mulberry32) so every run produces the same data. */
function prng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function step<T>(label: string, run: () => Promise<T>): Promise<T> {
  const started = Date.now()
  const result = await run()
  console.log(`  ✓ ${label} (${((Date.now() - started) / 1000).toFixed(1)}s)`)
  return result
}

async function main() {
  const env = getServerEnv()
  if (env.APP_ENV === "production" || env.APP_ENV === "staging") {
    throw new Error(`Refusing to seed demo data into ${env.APP_ENV}.`)
  }
  const [seeded] = await getDb()
    .select({ id: departments.id })
    .from(departments)
    .where(eq(departments.slug, "men"))
  if (seeded) {
    console.log(
      "Demo data is already present. To start over: npm run db:reset && npm run db:seed",
    )
    return
  }

  suppressRevalidation()
  const actor = systemActor("seed")
  const random = prng(20261013)
  console.log("Seeding demo data…")

  await step("job queues", async () => {
    const boss = createBoss("worker")
    await boss.start()
    await ensureQueues(boss)
    await boss.stop({ graceful: false })
  })

  await step("warehouse", () =>
    createStockLocation(actor, {
      code: "bhiwandi",
      name: "Duis Warehouse",
      addressLine1: "Building 4, Logistics Park, Bhiwandi",
      city: "Thane",
      stateCode: "IN-MH",
      postalCode: "421302",
      isDefault: true,
    }),
  )

  const attributeIds: Record<string, string> = {}
  const values: Record<string, Record<string, string>> = {}
  await step("attributes", async () => {
    const make = async (
      code: string,
      name: string,
      isVariantAxis: boolean,
      kind: "swatch" | "text" = "text",
    ) => {
      attributeIds[code] = (
        await createAttribute(actor, { code, name, isVariantAxis, kind })
      ).id
      values[code] = {}
    }
    await make("color", "Colour", true, "swatch")
    await make("size", "Size", true)
    for (const [code, slugs] of Object.entries(DESCRIPTIVE)) {
      await make(code, code[0]!.toUpperCase() + code.slice(1), false)
      for (const [position, slug] of slugs.entries()) {
        const label = slug
          .replace(/-/g, " ")
          .replace(/^\w/, (c) => c.toUpperCase())
        values[code]![slug] = (
          await createAttributeValue(actor, {
            attributeId: attributeIds[code]!,
            slug,
            label,
            position,
          })
        ).id
      }
    }
    for (const [position, colour] of COLOURS.entries()) {
      values.color![colour.slug] = (
        await createAttributeValue(actor, {
          attributeId: attributeIds.color!,
          slug: colour.slug,
          label: colour.label,
          swatchHex: colour.hex,
          filterGroup: colour.group,
          position,
        })
      ).id
    }
    for (const [position, slug] of [...ALPHA_SIZES, ...WAIST_SIZES].entries()) {
      values.size![slug] = (
        await createAttributeValue(actor, {
          attributeId: attributeIds.size!,
          slug,
          label: slug.toUpperCase(),
          position,
        })
      ).id
    }
  })

  const categoryIds: Record<string, string> = {}
  await step("categories and size charts", async () => {
    const charts = {
      tops: (
        await createSizeChart(actor, {
          ...SIZE_CHARTS.tops,
          chart: SIZE_CHARTS.tops,
          unit: "in",
        })
      ).id,
      bottoms: (
        await createSizeChart(actor, {
          ...SIZE_CHARTS.bottoms,
          chart: SIZE_CHARTS.bottoms,
          unit: "in",
        })
      ).id,
    }
    const men = await createDepartment(actor, { slug: "men", name: "Men" })
    categoryIds.men = men.id
    for (const [position, root] of CATEGORY_TREE.entries()) {
      const parent = await createCategory(actor, {
        departmentId: men.id,
        slug: root.slug,
        name: root.name,
        defaultHsnCode: root.hsn,
        sizeChartId: root.chart ? charts[root.chart] : null,
        position,
      })
      categoryIds[root.slug] = parent.id
      for (const [childPosition, child] of (root.children ?? []).entries()) {
        categoryIds[child.slug] = (
          await createCategory(actor, {
            departmentId: men.id,
            parentId: parent.id,
            slug: child.slug,
            name: child.name,
            defaultHsnCode: child.hsn,
            position: childPosition,
          })
        ).id
      }
    }
  })

  const productIds: string[] = []
  await step("products, variants, images and stock", async () => {
    let index = 0
    for (const group of PRODUCT_GROUPS) {
      const sizes =
        group.sizes === "waist"
          ? WAIST_SIZES
          : ALPHA_SIZES.slice(
              0,
              group.category === "oversized-t-shirts" ||
                group.category === "hoodies"
                ? 6
                : 5,
            )
      for (const [groupIndex, seed] of group.products.entries()) {
        index++
        const slug = seed.name
          .toLowerCase()
          .replace(/é/g, "e")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "")
        const descriptive = [
          values.fit![seed.fit]!,
          values.pattern![seed.pattern ?? "solid"]!,
        ]
        if (group.garment !== "pants" && group.garment !== "shorts")
          descriptive.push(values.sleeve![seed.sleeve ?? "half-sleeve"]!)

        const product = await createProduct(actor, {
          departmentId: categoryIds.men!,
          slug,
          title: seed.name,
          description: paragraphs(
            `The ${seed.name} is cut ${seed.fit === "oversized" ? "oversized, with dropped shoulders and a boxy body" : `for a ${seed.fit} fit`}.`,
            `${group.fabric}. Pre-shrunk and garment-washed for a soft hand-feel from the first wear.`,
          ),
          specifications: [
            { label: "Fabric", value: group.fabric },
            {
              label: "Fit",
              value: seed.fit[0]!.toUpperCase() + seed.fit.slice(1),
            },
            {
              label: "Wash care",
              value: "Machine wash cold, inside out. Do not tumble dry.",
            },
          ],
          material: group.fabric,
          care: "Machine wash cold, inside out. Do not tumble dry.",
          manufacturerDetails:
            "Duis Apparel Pvt. Ltd. (demo), Andheri East, Mumbai 400069, India",
          weightGrams: group.weightGrams,
          tags: seed.tags ?? [],
          categoryIds: [categoryIds[group.category]!],
          axisAttributeIds: [attributeIds.color!, attributeIds.size!],
          descriptiveValueIds: descriptive,
        })
        productIds.push(product.id)

        await generateVariants(actor, {
          productId: product.id,
          axes: [
            {
              attributeId: attributeIds.color!,
              valueIds: seed.colours.map((c) => values.color![c]!),
            },
            {
              attributeId: attributeIds.size!,
              valueIds: sizes.map((s) => values.size![s]!),
            },
          ],
          pricePaise: seed.price * 100,
          mrpPaise: seed.mrp * 100,
          skuPrefix: `DU-${SKU_CODES[group.category]}-${String(groupIndex + 1).padStart(3, "0")}`,
        })

        const media: {
          mediaId: string
          colorValueId: string
          altOverride?: string
        }[] = []
        const used = new Set<number>()
        for (const [colourIndex, slugValue] of seed.colours.entries()) {
          const colour = COLOURS.find((c) => c.slug === slugValue)!
          const photos = productPhotos(group.garment, slugValue, used)
          for (const photo of photos) used.add(photo.id)
          // A photo can be shared by several products, so each names it.
          const frontAlt = `${seed.name} in ${colour.label}, front`
          const front = await uploadImage(actor, {
            bytes:
              photos[0]?.bytes ??
              (await garmentImage({
                garment: group.garment,
                hex: colour.hex,
                seed: index * 7 + colourIndex,
                graphic: seed.pattern === "graphic",
              })),
            altText: frontAlt,
          })
          media.push({
            mediaId: front.id,
            colorValueId: values.color![slugValue]!,
            ...(photos[0] ? { altOverride: frontAlt } : {}),
          })
          // A second view for the first colour: a second photo when there
          // is one, else the drawn back only when the front is drawn too.
          if (colourIndex === 0 && (photos[1] || !photos[0])) {
            const back = await uploadImage(actor, {
              bytes:
                photos[1]?.bytes ??
                (await garmentImage({
                  garment: group.garment,
                  hex: colour.hex,
                  seed: index * 7,
                  back: true,
                })),
              altText: `${seed.name} in ${colour.label}, ${photos[1] ? "another view" : "back"}`,
            })
            media.push({
              mediaId: back.id,
              colorValueId: values.color![slugValue]!,
              ...(photos[1]
                ? {
                    altOverride: `${seed.name} in ${colour.label}, another view`,
                  }
                : {}),
            })
          }
        }
        await setProductMedia(actor, { productId: product.id, items: media })

        const variants = await getDb().query.productVariants.findMany({
          where: (variant, { eq: equals }) =>
            equals(variant.productId, product.id),
          columns: { id: true },
        })
        for (const variant of variants) {
          // ~15% of sizes start sold out so back-in-stock and filters are testable.
          const quantity = random() < 0.15 ? 0 : 3 + Math.floor(random() * 38)
          if (quantity > 0)
            await adjustStock(actor, {
              variantId: variant.id,
              delta: quantity,
              reason: "receive",
              note: "Opening stock (seed)",
            })
        }
        await publishProduct(actor, { id: product.id })
      }
    }
    return productIds.length
  })

  const collectionIds: Record<string, string> = {}
  const promoMedia: string[] = []
  const heroMedia: string[] = []
  await step("collections and banners", async () => {
    const palettes: [string, string, string][] = [
      ["#111111", "#b7472a", "#d9a521"],
      ["#1f2a44", "#d9a521", "#f4f4f2"],
      ["#b7472a", "#111111", "#ece5d8"],
      ["#2e3a59", "#9cbbd9", "#f4f4f2"],
      ["#556b2f", "#d8c3a5", "#111111"],
    ]
    for (const [i, palette] of palettes.entries()) {
      const photo = bannerPhoto(i)
      const banner = await uploadImage(actor, {
        bytes: photo ?? (await bannerImage(i, palette)),
        altText: photo ? "Duis campaign photo" : "Duis campaign banner",
      })
      ;(i < 2 ? heroMedia : promoMedia).push(banner.id)
    }

    const pick = (step: number, count: number) =>
      productIds.filter((_, i) => i % step === 0).slice(0, count)
    const definitions = [
      {
        slug: "new-arrivals",
        title: "New Arrivals",
        type: "automatic" as const,
        sortMode: "newest" as const,
        rules: [{ field: "created_within_days" as const, days: 30 }],
      },
      {
        slug: "best-sellers",
        title: "Best Sellers",
        type: "manual" as const,
        products: pick(5, 12),
      },
      {
        slug: "trending-now",
        title: "Trending Now",
        type: "manual" as const,
        products: pick(7, 8),
      },
      {
        slug: "oversized-essentials",
        title: "Oversized Essentials",
        type: "automatic" as const,
        rules: [
          {
            field: "category" as const,
            categoryIds: [categoryIds["oversized-t-shirts"]!],
          },
        ],
      },
      {
        slug: "under-999",
        title: "Under ₹999",
        type: "automatic" as const,
        sortMode: "price_asc" as const,
        rules: [
          {
            field: "price" as const,
            operator: "lte" as const,
            valuePaise: 99_900,
          },
        ],
      },
      {
        slug: "graphic-drop",
        title: "Graphic Drop",
        type: "automatic" as const,
        rules: [{ field: "tag" as const, tags: ["graphic"] }],
      },
      {
        slug: "winter-layers",
        title: "Winter Layers",
        type: "automatic" as const,
        rules: [{ field: "tag" as const, tags: ["winter"] }],
      },
      {
        slug: "summer-essentials",
        title: "Summer Essentials",
        type: "automatic" as const,
        rules: [{ field: "tag" as const, tags: ["summer"] }],
      },
      {
        slug: "denim-edit",
        title: "The Denim Edit",
        type: "automatic" as const,
        rules: [
          { field: "category" as const, categoryIds: [categoryIds.jeans!] },
        ],
      },
    ]
    for (const [i, definition] of definitions.entries()) {
      const { products, ...fields } =
        "products" in definition
          ? definition
          : { ...definition, products: undefined }
      const created = await createCollection(actor, {
        ...fields,
        bannerMediaId: promoMedia[i % promoMedia.length],
      } as never)
      if (products)
        await setCollectionProducts(actor, {
          collectionId: created.id,
          productIds: products,
        })
      await publishCollection(actor, { id: created.id })
      collectionIds[definition.slug] = created.id
    }
  })

  await step("site settings, navigation and pages", async () => {
    const publish = async (revision: { revisionId: string }) =>
      publishRevision(actor, { revisionId: revision.revisionId })
    await publish(await saveSiteSettingsDraft(actor, { data: siteSettings() }))
    const ids = {
      categories: categoryIds,
      collections: collectionIds,
      heroMedia,
      promoMedia,
    }
    await publish(
      await saveNavigationDraft(actor, {
        key: "header",
        name: "Header",
        data: headerNavigation(ids),
      }),
    )
    await publish(
      await saveNavigationDraft(actor, {
        key: "footer",
        name: "Footer",
        data: footerNavigation(),
      }),
    )

    const home = await createPage(actor, {
      type: "home",
      slug: "home",
      title: "Home",
    })
    await publish(
      await savePageDraft(actor, {
        pageId: home.id,
        data: homepage(ids),
        note: "Seeded homepage",
      }),
    )

    for (const page of STATIC_PAGES) {
      const created = await createPage(actor, {
        type: page.type,
        slug: page.slug,
        title: page.title,
      })
      await publish(
        await savePageDraft(actor, {
          pageId: created.id,
          data: {
            sections: [
              {
                id: "body",
                type: "rich_text",
                enabled: true,
                content: paragraphs(...page.body),
              },
            ],
            seo: { title: page.title },
          },
        }),
      )
    }
    const faq = await createPage(actor, {
      type: "static",
      slug: "faq",
      title: "Frequently asked questions",
    })
    await publish(
      await savePageDraft(actor, {
        pageId: faq.id,
        data: {
          sections: [
            {
              id: "faq",
              type: "faq_list",
              enabled: true,
              heading: "FAQ",
              items: FAQ.map((item) => ({
                question: item.question,
                answer: paragraphs(item.answer),
              })),
            },
          ],
          seo: { title: "FAQ" },
        },
      }),
    )
  })

  await step("promotions", async () => {
    await createDiscount(actor, {
      name: "Welcome 10% off",
      kind: "coupon",
      code: "WELCOME10",
      valueType: "percentage",
      value: 1_000,
      maxDiscountPaise: 30_000,
      eligibility: { firstOrderOnly: true },
      usageLimitPerCustomer: 1,
    })
    await createDiscount(actor, {
      name: "₹150 off orders of ₹1,499+",
      kind: "coupon",
      code: "FLAT150",
      valueType: "fixed",
      value: 15_000,
      minOrderPaise: 149_900,
    })
    const summer = collectionIds["summer-essentials"]
    if (summer) {
      await createDiscount(actor, {
        name: "Summer edit 15% off",
        kind: "automatic",
        valueType: "percentage",
        value: 1_500,
        targets: [{ type: "collection", id: summer }],
      })
    }
  })

  const accounts = await step("staff and customer accounts", async () => {
    const created: { email: string; role: string }[] = []
    for (const role of [...STAFF_ROLES, "customer" as const]) {
      const email = `${role.replace(/_/g, "")}@duis.local`
      const { user } = await getAuth().api.signUpEmail({
        body: { email, password: DEV_PASSWORD, name: role.replace(/_/g, " ") },
      })
      await getDb()
        .update(users)
        .set({ role, emailVerified: true })
        .where(eq(users.id, user.id))
      created.push({ email, role })
    }
    return created
  })

  console.log(
    `\nSeeded ${productIds.length} products. Development accounts (password: ${DEV_PASSWORD}):`,
  )
  for (const account of accounts)
    console.log(`  ${account.role.padEnd(17)} ${account.email}`)
  console.log("Staff must set up two-factor authentication at first sign-in.\n")
}

main()
  .catch((err: unknown) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await stopSender()
    await closeDb()
  })
