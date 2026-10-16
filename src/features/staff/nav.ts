import type { PermissionRequest } from "@/server/auth/permissions"

export type AdminNavItem = {
  href: string
  label: string
  icon:
    | "dashboard"
    | "products"
    | "categories"
    | "attributes"
    | "sizeCharts"
    | "collections"
    | "inventory"
  permission?: PermissionRequest
}

export type AdminNavGroup = { label: string; items: AdminNavItem[] }

/** The admin sidebar; items a role can't use are not shown (doc/04 §3). */
export const ADMIN_NAV: AdminNavGroup[] = [
  {
    label: "Overview",
    items: [{ href: "/admin", label: "Dashboard", icon: "dashboard" }],
  },
  {
    label: "Catalogue",
    items: [
      {
        href: "/admin/products",
        label: "Products",
        icon: "products",
        permission: { catalog: ["read"] },
      },
      {
        href: "/admin/categories",
        label: "Categories",
        icon: "categories",
        permission: { catalog: ["read"] },
      },
      {
        href: "/admin/attributes",
        label: "Attributes",
        icon: "attributes",
        permission: { catalog: ["read"] },
      },
      {
        href: "/admin/size-charts",
        label: "Size charts",
        icon: "sizeCharts",
        permission: { catalog: ["read"] },
      },
      {
        href: "/admin/collections",
        label: "Collections",
        icon: "collections",
        permission: { collection: ["read"] },
      },
      {
        href: "/admin/inventory",
        label: "Inventory",
        icon: "inventory",
        permission: { inventory: ["read"] },
      },
    ],
  },
]
