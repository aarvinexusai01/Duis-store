"use client"

import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react"
import type { ReactNode } from "react"

import { RichTextEditor } from "@/components/admin/rich-text-editor"
import { Button } from "@/components/ui/button"
import type { Block, BlockType } from "@/features/cms"
import { paragraphs, type RichTextDocument } from "@/lib/rich-text"

import { useLabels } from "./labels"
import { MediaField, OptionListField, ProductListField } from "./pickers"

/** Errors for one section, keyed by path ("slides.0.mediaId"). */
export type FieldErrors = Record<string, string>

const field =
  "h-9 w-full rounded-sm border bg-card px-3 text-sm aria-invalid:border-destructive"

export const BLOCK_LABELS: Record<BlockType, string> = {
  hero_banner: "Hero banner",
  promo_slider: "Promo slider",
  announcement: "Announcement",
  category_showcase: "Category showcase",
  featured_collections: "Featured collections",
  product_rail: "Product rail",
  promo_banner_grid: "Promo banner grid",
  rich_text: "Text",
  brand_story: "Brand story",
  newsletter: "Newsletter sign-up",
  faq_list: "FAQ",
  image_with_text: "Image with text",
}

/** A new section of each type, as complete as it can be without choices. */
export function newBlock(type: BlockType): Block {
  const id = `${type}-${crypto.randomUUID().slice(0, 8)}`
  const base = { id, enabled: true }
  switch (type) {
    case "hero_banner":
    case "promo_slider":
      return {
        ...base,
        type,
        slides: [{ mediaId: "", textTone: "light" }],
      } as unknown as Block
    case "announcement":
      return { ...base, type, text: "Free shipping on orders over ₹999" }
    case "category_showcase":
      return { ...base, type, heading: "Shop by category", categoryIds: [] }
    case "featured_collections":
      return {
        ...base,
        type,
        heading: "Featured collections",
        collectionIds: [],
        layout: "grid",
      }
    case "product_rail":
      return {
        ...base,
        type,
        heading: "New arrivals",
        source: { type: "new_arrivals" },
        limit: 12,
      }
    case "promo_banner_grid":
      return {
        ...base,
        type,
        banners: [{ mediaId: "", href: "/shop" }],
      } as unknown as Block
    case "rich_text":
      return { ...base, type, content: paragraphs("Write something here.") }
    case "brand_story":
      return {
        ...base,
        type,
        heading: "Our story",
        content: paragraphs("Tell people what Duis stands for."),
      }
    case "newsletter":
      return { ...base, type, heading: "Get first dibs on drops" }
    case "faq_list":
      return {
        ...base,
        type,
        heading: "Questions",
        items: [
          { question: "A common question?", answer: paragraphs("The answer.") },
        ],
      }
    case "image_with_text":
      return {
        ...base,
        type,
        mediaId: "",
        heading: "A heading",
        content: paragraphs("Some text."),
        imagePosition: "left",
      } as unknown as Block
  }
}

// --- Small fields ----------------------------------------------------------------------

function Labelled({
  label,
  error,
  hint,
  children,
}: {
  label: string
  error?: string
  hint?: string
  children: (props: { "aria-invalid"?: true }) => ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children(error ? { "aria-invalid": true } : {})}
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

function Text({
  label,
  value,
  onChange,
  error,
  hint,
  maxLength,
}: {
  label: string
  value: string | undefined
  onChange: (value: string) => void
  error?: string
  hint?: string
  maxLength: number
}) {
  return (
    <Labelled label={label} error={error} hint={hint}>
      {(props) => (
        <input
          {...props}
          value={value ?? ""}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
          className={field}
        />
      )}
    </Labelled>
  )
}

const optional = (value: string) => (value.trim() ? value : undefined)

function LinkFields({
  prefix,
  value,
  onChange,
  errors,
  optionalLink = true,
}: {
  prefix: string
  value: { label: string; href: string } | undefined
  onChange: (value: { label: string; href: string } | undefined) => void
  errors: FieldErrors
  optionalLink?: boolean
}) {
  const update = (next: { label: string; href: string }) =>
    onChange(
      optionalLink && !next.label.trim() && !next.href.trim()
        ? undefined
        : next,
    )
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Text
        label="Button text"
        value={value?.label}
        maxLength={40}
        error={errors[`${prefix}.label`]}
        onChange={(label) => update({ label, href: value?.href ?? "" })}
      />
      <Text
        label="Button link"
        value={value?.href}
        maxLength={500}
        hint="A site path like /shop, or an https link."
        error={errors[`${prefix}.href`]}
        onChange={(href) => update({ label: value?.label ?? "", href })}
      />
    </div>
  )
}

function RichText({
  label,
  value,
  onChange,
  error,
}: {
  label: string
  value: RichTextDocument
  onChange: (value: RichTextDocument) => void
  error?: string
}) {
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      <RichTextEditor
        label={label}
        value={value}
        onChange={(doc) => onChange(doc ?? paragraphs(""))}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

/** Edit, reorder, add and remove items in a list (slides, banners, FAQs). */
function ItemList<T>({
  items,
  onChange,
  render,
  make,
  max,
  noun,
}: {
  items: T[]
  onChange: (items: T[]) => void
  render: (item: T, update: (item: T) => void, index: number) => ReactNode
  make: () => T
  max: number
  noun: string
}) {
  const move = (index: number, by: number) => {
    const next = [...items]
    const [item] = next.splice(index, 1)
    next.splice(index + by, 0, item!)
    onChange(next)
  }
  return (
    <div className="flex flex-col gap-3">
      {items.map((item, index) => (
        <fieldset
          key={index}
          className="flex flex-col gap-3 rounded-sm border bg-background p-3"
        >
          <legend className="flex items-center gap-1 px-1 text-xs font-semibold uppercase">
            {noun} {index + 1}
            <button
              type="button"
              aria-label={`Move ${noun} ${index + 1} up`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
              className="disabled:opacity-30"
            >
              <ArrowUpIcon className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              aria-label={`Move ${noun} ${index + 1} down`}
              disabled={index === items.length - 1}
              onClick={() => move(index, 1)}
              className="disabled:opacity-30"
            >
              <ArrowDownIcon className="size-3.5" aria-hidden />
            </button>
            <button
              type="button"
              aria-label={`Remove ${noun} ${index + 1}`}
              disabled={items.length === 1}
              onClick={() => onChange(items.filter((_, i) => i !== index))}
              className="disabled:opacity-30"
            >
              <Trash2Icon className="size-3.5" aria-hidden />
            </button>
          </legend>
          {render(
            item,
            (next) => onChange(items.map((it, i) => (i === index ? next : it))),
            index,
          )}
        </fieldset>
      ))}
      {items.length < max && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="self-start rounded-sm"
          onClick={() => onChange([...items, make()])}
        >
          <PlusIcon className="size-4" aria-hidden /> Add {noun.toLowerCase()}
        </Button>
      )}
    </div>
  )
}

// --- One form per block type -----------------------------------------------------------

type SlideValue = Extract<Block, { type: "hero_banner" }>["slides"][number]

function Slides({
  slides,
  onChange,
  errors,
  max,
}: {
  slides: SlideValue[]
  onChange: (slides: SlideValue[]) => void
  errors: FieldErrors
  max: number
}) {
  return (
    <ItemList
      items={slides}
      onChange={onChange}
      max={max}
      noun="Slide"
      make={() => ({ mediaId: "", textTone: "light" }) as SlideValue}
      render={(slide, update, i) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <MediaField
              label="Image"
              value={slide.mediaId || undefined}
              error={errors[`slides.${i}.mediaId`]}
              onChange={(mediaId) =>
                update({ ...slide, mediaId: mediaId ?? "" })
              }
            />
            <MediaField
              label="Mobile image"
              optional
              value={slide.mobileMediaId}
              onChange={(mobileMediaId) => update({ ...slide, mobileMediaId })}
            />
          </div>
          <Text
            label="Heading"
            value={slide.heading}
            maxLength={80}
            error={errors[`slides.${i}.heading`]}
            onChange={(v) => update({ ...slide, heading: optional(v) })}
          />
          <Text
            label="Subheading"
            value={slide.subheading}
            maxLength={160}
            error={errors[`slides.${i}.subheading`]}
            onChange={(v) => update({ ...slide, subheading: optional(v) })}
          />
          <LinkFields
            prefix={`slides.${i}.cta`}
            value={slide.cta}
            errors={errors}
            onChange={(cta) => update({ ...slide, cta })}
          />
          <Labelled label="Text colour">
            {() => (
              <select
                value={slide.textTone}
                onChange={(event) =>
                  update({
                    ...slide,
                    textTone: event.target.value as "light" | "dark",
                  })
                }
                className={field}
              >
                <option value="light">Light (for dark images)</option>
                <option value="dark">Dark (for light images)</option>
              </select>
            )}
          </Labelled>
        </>
      )}
    />
  )
}

export function BlockForm({
  block,
  onChange,
  errors,
}: {
  block: Block
  onChange: (block: Block) => void
  errors: FieldErrors
}) {
  const labels = useLabels()
  const set = (patch: Partial<Block>) =>
    onChange({ ...block, ...patch } as Block)

  switch (block.type) {
    case "hero_banner":
    case "promo_slider":
      return (
        <Slides
          slides={block.slides}
          max={block.type === "hero_banner" ? 6 : 10}
          errors={errors}
          onChange={(slides) => set({ slides })}
        />
      )
    case "announcement":
      return (
        <div className="grid gap-3">
          <Text
            label="Text"
            value={block.text}
            maxLength={140}
            error={errors.text}
            onChange={(text) => set({ text })}
          />
          <Text
            label="Link"
            value={block.href}
            maxLength={500}
            hint="Optional. A site path like /shop, or an https link."
            error={errors.href}
            onChange={(href) => set({ href: optional(href) })}
          />
        </div>
      )
    case "category_showcase":
      return (
        <div className="grid gap-3">
          <Text
            label="Heading"
            value={block.heading}
            maxLength={80}
            error={errors.heading}
            onChange={(heading) => set({ heading })}
          />
          <OptionListField
            label="Categories"
            options={labels.categories}
            value={block.categoryIds}
            error={errors.categoryIds}
            onChange={(categoryIds) => set({ categoryIds })}
          />
        </div>
      )
    case "featured_collections":
      return (
        <div className="grid gap-3">
          <Text
            label="Heading"
            value={block.heading}
            maxLength={80}
            error={errors.heading}
            onChange={(heading) => set({ heading })}
          />
          <OptionListField
            label="Collections"
            options={labels.collections}
            value={block.collectionIds}
            error={errors.collectionIds}
            onChange={(collectionIds) => set({ collectionIds })}
          />
          <Labelled label="Layout">
            {() => (
              <select
                value={block.layout}
                onChange={(event) =>
                  set({
                    layout: event.target.value as
                      "grid" | "carousel" | "banner",
                  })
                }
                className={field}
              >
                <option value="grid">Grid of squares</option>
                <option value="carousel">Carousel</option>
                <option value="banner">Wide banners</option>
              </select>
            )}
          </Labelled>
        </div>
      )
    case "product_rail": {
      const source = block.source
      return (
        <div className="grid gap-3">
          <Text
            label="Heading"
            value={block.heading}
            maxLength={80}
            error={errors.heading}
            onChange={(heading) => set({ heading })}
          />
          <Labelled label="Products">
            {() => (
              <select
                value={source.type}
                onChange={(event) => {
                  const type = event.target.value as typeof source.type
                  set({
                    source:
                      type === "collection"
                        ? {
                            type,
                            collectionId: labels.collections[0]?.id ?? "",
                          }
                        : type === "products"
                          ? { type, productIds: [] }
                          : { type },
                  })
                }}
                className={field}
              >
                <option value="new_arrivals">Newest products</option>
                <option value="best_sellers">Best sellers</option>
                <option value="trending">Trending</option>
                <option value="collection">From a collection</option>
                <option value="products">Hand-picked products</option>
              </select>
            )}
          </Labelled>
          {source.type === "collection" && (
            <Labelled label="Collection" error={errors["source.collectionId"]}>
              {(props) => (
                <select
                  {...props}
                  value={source.collectionId}
                  onChange={(event) =>
                    set({
                      source: {
                        type: "collection",
                        collectionId: event.target.value,
                      },
                    })
                  }
                  className={field}
                >
                  {labels.collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              )}
            </Labelled>
          )}
          {source.type === "products" && (
            <ProductListField
              label="Products"
              value={source.productIds}
              error={errors["source.productIds"]}
              onChange={(productIds) =>
                set({ source: { type: "products", productIds } })
              }
            />
          )}
          <Labelled label="How many to show" error={errors.limit}>
            {(props) => (
              <input
                {...props}
                type="number"
                min={4}
                max={24}
                value={block.limit}
                onChange={(event) => set({ limit: Number(event.target.value) })}
                className={field}
              />
            )}
          </Labelled>
          <LinkFields
            prefix="cta"
            value={block.cta}
            errors={errors}
            onChange={(cta) => set({ cta })}
          />
        </div>
      )
    }
    case "promo_banner_grid":
      return (
        <ItemList
          items={block.banners}
          onChange={(banners) => set({ banners })}
          max={4}
          noun="Banner"
          make={() =>
            ({ mediaId: "", href: "/shop" }) as (typeof block.banners)[number]
          }
          render={(banner, update, i) => (
            <>
              <MediaField
                label="Image"
                value={banner.mediaId || undefined}
                error={errors[`banners.${i}.mediaId`]}
                onChange={(mediaId) =>
                  update({ ...banner, mediaId: mediaId ?? "" })
                }
              />
              <Text
                label="Heading"
                value={banner.heading}
                maxLength={60}
                error={errors[`banners.${i}.heading`]}
                onChange={(heading) =>
                  update({ ...banner, heading: optional(heading) })
                }
              />
              <Text
                label="Link"
                value={banner.href}
                maxLength={500}
                hint="A site path like /shop, or an https link."
                error={errors[`banners.${i}.href`]}
                onChange={(href) => update({ ...banner, href })}
              />
            </>
          )}
        />
      )
    case "rich_text":
      return (
        <RichText
          label="Text"
          value={block.content}
          error={errors.content}
          onChange={(content) => set({ content })}
        />
      )
    case "brand_story":
    case "image_with_text":
      return (
        <div className="grid gap-3">
          <Text
            label="Heading"
            value={block.heading}
            maxLength={80}
            error={errors.heading}
            onChange={(heading) => set({ heading })}
          />
          <RichText
            label="Text"
            value={block.content}
            error={errors.content}
            onChange={(content) => set({ content })}
          />
          <MediaField
            label="Image"
            optional={block.type === "brand_story"}
            value={block.mediaId || undefined}
            error={errors.mediaId}
            onChange={(mediaId) =>
              set({
                mediaId:
                  block.type === "brand_story" ? mediaId : (mediaId ?? ""),
              })
            }
          />
          {block.type === "image_with_text" && (
            <Labelled label="Image side">
              {() => (
                <select
                  value={block.imagePosition}
                  onChange={(event) =>
                    set({
                      imagePosition: event.target.value as "left" | "right",
                    })
                  }
                  className={field}
                >
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </select>
              )}
            </Labelled>
          )}
          <LinkFields
            prefix="cta"
            value={block.cta}
            errors={errors}
            onChange={(cta) => set({ cta })}
          />
        </div>
      )
    case "newsletter":
      return (
        <div className="grid gap-3">
          <Text
            label="Heading"
            value={block.heading}
            maxLength={80}
            error={errors.heading}
            onChange={(heading) => set({ heading })}
          />
          <Text
            label="Subheading"
            value={block.subheading}
            maxLength={160}
            error={errors.subheading}
            onChange={(subheading) => set({ subheading: optional(subheading) })}
          />
        </div>
      )
    case "faq_list":
      return (
        <div className="grid gap-3">
          <Text
            label="Heading"
            value={block.heading}
            maxLength={80}
            error={errors.heading}
            onChange={(heading) => set({ heading })}
          />
          <ItemList
            items={block.items}
            onChange={(items) => set({ items })}
            max={40}
            noun="Question"
            make={() => ({ question: "", answer: paragraphs("") })}
            render={(item, update, i) => (
              <>
                <Text
                  label="Question"
                  value={item.question}
                  maxLength={200}
                  error={errors[`items.${i}.question`]}
                  onChange={(question) => update({ ...item, question })}
                />
                <RichText
                  label="Answer"
                  value={item.answer}
                  error={errors[`items.${i}.answer`]}
                  onChange={(answer) => update({ ...item, answer })}
                />
              </>
            )}
          />
        </div>
      )
  }
}
