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
    | "orders"
    | "cod"
    | "customers"
    | "discounts"
    | "exchanges"
    | "reviews"
    | "reports"
    | "staff"
    | "audit"
    | "system"
    | "settings"
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
    label: "Sales",
    items: [
      {
        href: "/admin/orders",
        label: "Orders",
        icon: "orders",
        permission: { order: ["read"] },
      },
      {
        href: "/admin/orders/cod",
        label: "COD remittances",
        icon: "cod",
        permission: { order: ["read_financials"] },
      },
      {
        href: "/admin/exchanges",
        label: "Exchanges",
        icon: "exchanges",
        permission: { exchange: ["read"] },
      },
      {
        href: "/admin/reviews",
        label: "Reviews",
        icon: "reviews",
        permission: { review: ["read"] },
      },
      {
        href: "/admin/customers",
        label: "Customers",
        icon: "customers",
        permission: { customer: ["read"] },
      },
      {
        href: "/admin/discounts",
        label: "Discounts",
        icon: "discounts",
        permission: { discount: ["read"] },
      },
    ],
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
  {
    label: "Administration",
    items: [
      {
        href: "/admin/reports",
        label: "Reports",
        icon: "reports",
        permission: { report: ["read"] },
      },
      {
        href: "/admin/staff",
        label: "Staff",
        icon: "staff",
        permission: { staff: ["read"] },
      },
      {
        href: "/admin/audit",
        label: "Audit log",
        icon: "audit",
        permission: { audit: ["read"] },
      },
      {
        href: "/admin/system",
        label: "System",
        icon: "system",
        permission: { system: ["read"] },
      },
      {
        href: "/admin/settings",
        label: "Settings",
        icon: "settings",
        permission: { settings: ["read"] },
      },
    ],
  },
]
