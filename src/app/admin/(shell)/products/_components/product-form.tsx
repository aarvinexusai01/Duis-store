"use client"

import { PlusIcon, Trash2Icon } from "lucide-react"
import { useMemo, useState, useTransition } from "react"
import { toast } from "sonner"

import { RichTextEditor } from "@/components/admin/rich-text-editor"
import { Button } from "@/components/ui/button"
import type { AdminProduct, CatalogOptions } from "@/features/catalog"
import {
  createProductAction,
  updateProductAction,
} from "@/features/catalog/admin-actions"
import { COUNTRY_CODES, countryName } from "@/lib/countries"
import type { RichTextDocument } from "@/lib/rich-text"
import { slugify } from "@/lib/slug"
import { cn } from "@/lib/utils"

type Errors = Record<string, string[] | undefined>

const input = "h-9 w-full rounded-sm border border-input bg-card px-2 text-sm"

function Field({
  label,
  name,
  errors,
  hint,
  children,
  className,
}: {
  label: string
  name: string
  errors: Errors
  hint?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={`pf-${name}`} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {errors[name] && (
        <p className="text-xs text-destructive">{errors[name]![0]}</p>
      )}
    </div>
  )
}

/**
 * Product details (doc/06 Phase 4 §3). Department and variant axes are
 * chosen when the product is created; categories, descriptive values and
 * everything else can change later.
 */
export function ProductForm({
  options,
  product,
  canEdit,
}: {
  options: CatalogOptions
  product: AdminProduct | null
  canEdit: boolean
}) {
  const creating = product === null
  const [pending, startTransition] = useTransition()
  const [errors, setErrors] = useState<Errors>({})
  const [message, setMessage] = useState("")

  const [departmentId, setDepartmentId] = useState(
    product?.departmentId ?? options.departments[0]?.id ?? "",
  )
  const [title, setTitle] = useState(product?.title ?? "")
  const [slug, setSlug] = useState(product?.slug ?? "")
  const [slugTouched, setSlugTouched] = useState(!creating)
  const [description, setDescription] = useState<RichTextDocument | null>(
    product?.description ?? null,
  )
  const [categoryIds, setCategoryIds] = useState<string[]>(
    product?.categoryIds ?? [],
  )
  const [axisIds, setAxisIds] = useState<string[]>(
    product?.axisAttributeIds ?? [],
  )
  const [valueIds, setValueIds] = useState<string[]>(
    product?.descriptiveValueIds ?? [],
  )
  const [specs, setSpecs] = useState(product?.specifications ?? [])

  const categories = useMemo(
    () => options.categories.filter((c) => c.departmentId === departmentId),
    [options.categories, departmentId],
  )
  const axisAttributes = options.attributes.filter((a) => a.isVariantAxis)
  const descriptive = options.attributes.filter((a) => !a.isVariantAxis)

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id]

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = (name: string) => String(form.get(name) ?? "").trim()
    const optional = (name: string) => text(name) || null
    const fields = {
      slug,
      title,
      subtitle: optional("subtitle"),
      description,
      specifications: specs.filter((s) => s.label.trim() && s.value.trim()),
      material: optional("material"),
      care: optional("care"),
      ...(text("hsnCode") ? { hsnCode: text("hsnCode") } : {}),
      countryOfOrigin: text("countryOfOrigin"),
      manufacturerDetails: text("manufacturerDetails"),
      netQuantity: text("netQuantity") || "1 N",
      weightGrams: Number(text("weightGrams")),
      tags: text("tags")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      categoryIds,
      descriptiveValueIds: valueIds,
      seoTitle: optional("seoTitle"),
      seoDescription: optional("seoDescription"),
      noindex: form.get("noindex") === "on",
    }
    setErrors({})
    setMessage("")
    startTransition(async () => {
      const result = creating
        ? await createProductAction({
            ...fields,
            departmentId,
            axisAttributeIds: axisIds,
          })
        : await updateProductAction({
            ...fields,
            id: product.id,
            // The version this page loaded; every save (and publish or
            // archive) refreshes the page, so it stays current. A save from
            // an older one is refused, so two people never overwrite each
            // other.
            expectedVersion: product.version,
          })
      if (result.ok) {
        toast.success("Product saved")
      } else {
        setErrors(result.fieldErrors ?? {})
        setMessage(result.message)
      }
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <fieldset
        disabled={!canEdit || pending}
        className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]"
      >
        <div className="flex flex-col gap-4 rounded-sm border bg-card p-4">
          <Field label="Title" name="title" errors={errors}>
            <input
              id="pf-title"
              value={title}
              required
              maxLength={150}
              onChange={(e) => {
                setTitle(e.target.value)
                if (!slugTouched) setSlug(slugify(e.target.value))
              }}
              className={input}
            />
          </Field>
          <Field
            label="URL slug"
            name="slug"
            errors={errors}
            hint={`duis store /products/${slug || "…"}`}
          >
            <input
              id="pf-slug"
              value={slug}
              required
              onChange={(e) => {
                setSlugTouched(true)
                setSlug(e.target.value)
              }}
              className={input}
            />
          </Field>
          <Field label="Subtitle" name="subtitle" errors={errors}>
            <input
              id="pf-subtitle"
              name="subtitle"
              defaultValue={product?.subtitle ?? ""}
              maxLength={200}
              className={input}
            />
          </Field>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">Description</span>
            <RichTextEditor
              value={description}
              onChange={setDescription}
              label="Description"
            />
            {errors.description && (
              <p className="text-xs text-destructive">
                Check the description formatting.
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Specifications</span>
            {specs.map((spec, index) => (
              <div key={index} className="flex gap-2">
                <input
                  aria-label="Specification name"
                  value={spec.label}
                  placeholder="Fabric"
                  onChange={(e) =>
                    setSpecs(
                      specs.map((s, i) =>
                        i === index ? { ...s, label: e.target.value } : s,
                      ),
                    )
                  }
                  className={cn(input, "w-40")}
                />
                <input
                  aria-label="Specification value"
                  value={spec.value}
                  placeholder="100% cotton, 240 GSM"
                  onChange={(e) =>
                    setSpecs(
                      specs.map((s, i) =>
                        i === index ? { ...s, value: e.target.value } : s,
                      ),
                    )
                  }
                  className={input}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setSpecs(specs.filter((_, i) => i !== index))}
                >
                  <Trash2Icon />
                  <span className="sr-only">Remove</span>
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => setSpecs([...specs, { label: "", value: "" }])}
            >
              <PlusIcon /> Add specification
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Material" name="material" errors={errors}>
              <input
                id="pf-material"
                name="material"
                defaultValue={product?.material ?? ""}
                className={input}
              />
            </Field>
            <Field label="Care" name="care" errors={errors}>
              <input
                id="pf-care"
                name="care"
                defaultValue={product?.care ?? ""}
                className={input}
              />
            </Field>
          </div>
          <fieldset className="grid gap-4 border-t pt-4 sm:grid-cols-2">
            <legend className="text-sm font-semibold">
              Legal and shipping
            </legend>
            <Field
              label="HSN code"
              name="hsnCode"
              errors={errors}
              hint="Leave empty to use the category's code."
            >
              <input
                id="pf-hsnCode"
                name="hsnCode"
                defaultValue={product?.hsnCode ?? ""}
                inputMode="numeric"
                className={input}
              />
            </Field>
            <Field
              label="Country of origin"
              name="countryOfOrigin"
              errors={errors}
            >
              <select
                id="pf-countryOfOrigin"
                name="countryOfOrigin"
                defaultValue={product?.countryOfOrigin ?? "IN"}
                className={input}
              >
                {COUNTRY_CODES.map((code) => (
                  <option key={code} value={code}>
                    {countryName(code)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Manufacturer / packer"
              name="manufacturerDetails"
              errors={errors}
              className="sm:col-span-2"
            >
              <textarea
                id="pf-manufacturerDetails"
                name="manufacturerDetails"
                defaultValue={product?.manufacturerDetails ?? ""}
                required
                rows={2}
                className="rounded-sm border border-input bg-card px-2 py-1 text-sm"
              />
            </Field>
            <Field label="Net quantity" name="netQuantity" errors={errors}>
              <input
                id="pf-netQuantity"
                name="netQuantity"
                defaultValue={product?.netQuantity ?? "1 N"}
                className={input}
              />
            </Field>
            <Field
              label="Weight (grams)"
              name="weightGrams"
              errors={errors}
              hint="Packed weight for courier rates."
            >
              <input
                id="pf-weightGrams"
                name="weightGrams"
                type="number"
                min={1}
                defaultValue={product?.weightGrams ?? 300}
                required
                className={input}
              />
            </Field>
          </fieldset>
          <fieldset className="grid gap-4 border-t pt-4">
            <legend className="text-sm font-semibold">Search engines</legend>
            <Field
              label="SEO title"
              name="seoTitle"
              errors={errors}
              hint="Up to 70 characters."
            >
              <input
                id="pf-seoTitle"
                name="seoTitle"
                defaultValue={product?.seoTitle ?? ""}
                maxLength={70}
                className={input}
              />
            </Field>
            <Field
              label="SEO description"
              name="seoDescription"
              errors={errors}
              hint="Up to 170 characters."
            >
              <textarea
                id="pf-seoDescription"
                name="seoDescription"
                defaultValue={product?.seoDescription ?? ""}
                maxLength={170}
                rows={2}
                className="rounded-sm border border-input bg-card px-2 py-1 text-sm"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="noindex"
                defaultChecked={product?.noindex}
              />{" "}
              Hide from search engines
            </label>
          </fieldset>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-sm border bg-card p-4">
            <Field label="Department" name="departmentId" errors={errors}>
              <select
                id="pf-departmentId"
                value={departmentId}
                disabled={!creating}
                onChange={(e) => {
                  setDepartmentId(e.target.value)
                  setCategoryIds([])
                }}
                className={input}
              >
                {options.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
            <fieldset>
              <legend className="mb-1 text-sm font-medium">Categories</legend>
              <p className="mb-2 text-xs text-muted-foreground">
                The first one ticked is the main category (breadcrumbs, size
                chart).
              </p>
              <ul className="max-h-64 overflow-y-auto text-sm">
                {categories.map((c) => (
                  <li key={c.id} style={{ paddingLeft: c.depth * 12 }}>
                    <label className="flex items-center gap-2 py-0.5">
                      <input
                        type="checkbox"
                        checked={categoryIds.includes(c.id)}
                        onChange={() =>
                          setCategoryIds(toggle(categoryIds, c.id))
                        }
                      />
                      {c.name}
                      {categoryIds[0] === c.id && (
                        <span className="text-xs text-rust">main</span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
              {errors.categoryIds && (
                <p className="text-xs text-destructive">
                  Choose at least one category.
                </p>
              )}
            </fieldset>
          </div>

          <div className="flex flex-col gap-3 rounded-sm border bg-card p-4">
            <fieldset disabled={!creating}>
              <legend className="mb-1 text-sm font-medium">
                Variant options
              </legend>
              <p className="mb-2 text-xs text-muted-foreground">
                {creating
                  ? "What customers choose between, in order (e.g. Colour, then Size)."
                  : "Fixed once created."}
              </p>
              {axisAttributes.map((a) => (
                <label
                  key={a.id}
                  className="flex items-center gap-2 py-0.5 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={axisIds.includes(a.id)}
                    onChange={() => setAxisIds(toggle(axisIds, a.id))}
                  />
                  {a.name}
                  {axisIds.includes(a.id) && (
                    <span className="text-xs text-muted-foreground">
                      #{axisIds.indexOf(a.id) + 1}
                    </span>
                  )}
                </label>
              ))}
              {errors.axisAttributeIds && (
                <p className="text-xs text-destructive">
                  Choose at least one option.
                </p>
              )}
            </fieldset>
            {descriptive.map((a) => (
              <fieldset key={a.id}>
                <legend className="mb-1 text-sm font-medium">{a.name}</legend>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {a.values.map((v) => (
                    <label
                      key={v.id}
                      className="flex items-center gap-1.5 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={valueIds.includes(v.id)}
                        onChange={() => setValueIds(toggle(valueIds, v.id))}
                      />
                      {v.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <Field
              label="Tags"
              name="tags"
              errors={errors}
              hint="Comma-separated, e.g. streetwear, cotton"
            >
              <input
                id="pf-tags"
                name="tags"
                defaultValue={product?.tags.join(", ") ?? ""}
                className={input}
              />
            </Field>
          </div>
        </div>
      </fieldset>

      {message && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {message}
        </p>
      )}
      {canEdit && (
        <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t bg-background/95 px-4 py-3 md:-mx-6 md:px-6">
          <Button type="submit" disabled={pending} className="rounded-sm">
            {pending ? "Saving…" : creating ? "Create product" : "Save changes"}
          </Button>
        </div>
      )}
    </form>
  )
}
