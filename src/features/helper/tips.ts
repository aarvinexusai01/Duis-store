/**
 * What the admin helper says on each page. Plain words, one idea per tip.
 * Patterns match whole path segments; `*` stands for one segment (an id or
 * number). The most specific pattern wins.
 */

export type PageTips = { title: string; tips: string[] }

export const HELPER_NAME = "Miso"

export const PAGE_TIPS: Record<string, PageTips> = {
  "/admin": {
    title: "Dashboard",
    tips: [
      "This is the last 30 days at a glance. Some cards open the list behind them, like orders to ship.",
      "Low-stock items show here so you can reorder in time.",
      "Press ⌘K (Ctrl K on Windows) anywhere to jump to an order, product or page.",
    ],
  },

  // Sales
  "/admin/orders": {
    title: "Orders",
    tips: [
      "Newest orders are at the top. Filter by status or payment to see only what needs doing.",
      "Open an order to pack it, book the courier and print the label.",
      "Search by order number, customer, phone or tracking number (AWB).",
    ],
  },
  "/admin/orders/*": {
    title: "An order",
    tips: [
      "Work top to bottom: mark it as being packed, then book the parcel.",
      "Booking the parcel gets the tracking number (AWB) and label, and asks the courier to pick up.",
      "Notes are only seen by staff. Use them to hand over to a teammate.",
      "Cancelling a paid order refunds the customer, so double-check first.",
    ],
  },
  "/admin/orders/cod": {
    title: "COD remittances",
    tips: [
      "Cash on delivery money is collected by the courier and paid to the bank later.",
      "Record each payout here so every COD order is marked as paid.",
    ],
  },
  "/admin/exchanges": {
    title: "Exchanges",
    tips: [
      "Customers ask for a different size or colour here. Open a request to decide.",
      "After you approve, the return pickup and the new parcel are tracked on the same page.",
    ],
  },
  "/admin/exchanges/*": {
    title: "An exchange",
    tips: [
      "Check the photos and reason, then approve or reject. Add a short note to say why.",
      "Once approved, follow the parcels section: the return comes back, the new item goes out.",
    ],
  },
  "/admin/reviews": {
    title: "Reviews",
    tips: [
      "New reviews wait here before they show in the shop.",
      "Publish honest reviews, good or bad. Reject only spam or abuse.",
    ],
  },
  "/admin/customers": {
    title: "Customers",
    tips: [
      "Search by name, email or phone to find someone fast.",
      "Open a customer to see their orders, addresses and wallet credit.",
    ],
  },
  "/admin/customers/*": {
    title: "A customer",
    tips: [
      "Their orders, addresses and marketing choices are all on this page.",
      "Goodwill credit adds money to their wallet for a future order.",
    ],
  },
  "/admin/messages": {
    title: "Messages",
    tips: [
      "These come from the contact form on the website.",
      "Reply by email, then mark the message as replied so the team knows.",
    ],
  },
  "/admin/data-requests": {
    title: "Data requests",
    tips: [
      "Customers can ask for a copy of their data or for it to be deleted.",
      "Acknowledge within 48 hours and finish within a month. The law requires it.",
    ],
  },
  "/admin/discounts": {
    title: "Discounts",
    tips: [
      "Make a code (like WELCOME10) or an automatic offer that applies by itself.",
      "Set an end date and a usage limit so an offer can't run away.",
    ],
  },
  "/admin/discounts/new": {
    title: "New discount",
    tips: [
      "Choose percent off or a fixed amount, then who and what it applies to.",
      "Leave the end date empty only if the offer should run until you archive it.",
    ],
  },
  "/admin/discounts/*": {
    title: "A discount",
    tips: [
      "Usage shows how many times it's been used, and by whom.",
      "Generate codes makes many one-time codes at once, e.g. for influencers.",
      "Archiving stops a discount for good.",
    ],
  },

  // Catalogue
  "/admin/products": {
    title: "Products",
    tips: [
      "Drafts aren't in the shop yet. Publish a product when it's ready to sell.",
      "Press New product to start. Photos and sizes come after the first save.",
    ],
  },
  "/admin/products/new": {
    title: "New product",
    tips: [
      "Fill in the name, price and category, then save.",
      "After saving you can add photos and generate the colours and sizes.",
    ],
  },
  "/admin/products/*": {
    title: "Editing a product",
    tips: [
      "Generate variants makes one item for each colour and size you tick.",
      "Missing a colour or size? Use '+ Add new' right in the list.",
      "In Photos, assign pictures to a colour so the shop shows the right ones.",
      "Publish when everything looks right. It goes live in the shop straight away.",
    ],
  },
  "/admin/categories": {
    title: "Categories",
    tips: [
      "Categories are the shop's menu, like Men → T-shirts.",
      "Use the arrows to change the order. Pick a parent to put one category under another.",
    ],
  },
  "/admin/attributes": {
    title: "Attributes",
    tips: [
      "Colours, sizes and filters such as fit or sleeve length live here.",
      "Colours in the same filter group show as one filter in the shop, e.g. all blues.",
    ],
  },
  "/admin/size-charts": {
    title: "Size charts",
    tips: [
      "These are the measurements in the shop's size guide.",
      "Attach a chart to a category and all its products use it.",
    ],
  },
  "/admin/collections": {
    title: "Collections",
    tips: [
      "Hand-pick products for an edit, or set rules that fill it automatically.",
      "Automatic collections update by themselves as products change.",
    ],
  },
  "/admin/collections/new": {
    title: "New collection",
    tips: [
      "Pick hand-picked to choose products yourself, or rules to fill it automatically.",
    ],
  },
  "/admin/collections/*": {
    title: "A collection",
    tips: [
      "Search to add products, and use the arrows to set their order.",
      "Publish it to make it visible in the shop.",
    ],
  },
  "/admin/inventory": {
    title: "Inventory",
    tips: [
      "Press Adjust on a row and choose 'Received new stock' when a delivery arrives.",
      "Reserved units are held for orders still waiting for payment.",
      "Set a low-stock alert level so the dashboard warns you in time.",
    ],
  },
  "/admin/inventory/movements": {
    title: "Stock movements",
    tips: [
      "Every stock change is listed here, newest first, with who made it.",
      "This history can't be edited, so it's the place to check a mystery count.",
    ],
  },

  // Content
  "/admin/cms": {
    title: "Pages",
    tips: [
      "The home page, landing pages and info pages like About.",
      "Edits save as drafts. Nothing changes on the website until you publish.",
    ],
  },
  "/admin/cms/pages/*": {
    title: "Editing a page",
    tips: [
      "Use 'Add a section' to build the page. Changes save by themselves as a draft.",
      "Check the preview on desktop and mobile, then submit it for review.",
    ],
  },
  "/admin/cms/journal": {
    title: "Journal",
    tips: [
      "Stories for /journal. They follow the same draft → review → publish steps as pages.",
    ],
  },
  "/admin/cms/journal/*": {
    title: "Writing a story",
    tips: [
      "Mix text, images and shoppable products in the story.",
      "Send it for review when it's ready. A content manager publishes it.",
    ],
  },
  "/admin/cms/journal/settings": {
    title: "Authors, categories and tags",
    tips: [
      "Changes apply straight away.",
      "Something a story uses can't be deleted. Change the story first.",
    ],
  },
  "/admin/cms/navigation": {
    title: "Menus",
    tips: [
      "The website's header and footer menus. Changes save as drafts until published.",
    ],
  },
  "/admin/cms/navigation/*": {
    title: "Editing a menu",
    tips: [
      "Links can go to a category, collection, product, page or any web address. Use the arrows to reorder.",
      "Publish to update the website.",
    ],
  },
  "/admin/cms/settings": {
    title: "Site settings",
    tips: [
      "Brand, announcement bar, contact details and social links.",
      "Shipping, COD and tax rules are under Administration → Settings instead.",
    ],
  },
  "/admin/media": {
    title: "Media",
    tips: [
      "Every uploaded image lives here.",
      "An image in use can't be deleted until it's removed from where it's used.",
    ],
  },
  "/admin/cms/redirects": {
    title: "Redirects",
    tips: [
      "Send an old web address to a new one so links don't break.",
      "Changing a page or product address adds one for you.",
    ],
  },
  "/admin/cms/scheduled": {
    title: "Scheduled",
    tips: [
      "Content set to go live on its own, in India time.",
      "It goes live within a minute of the scheduled time.",
    ],
  },

  // Administration
  "/admin/reports": {
    title: "Reports",
    tips: [
      "Sales count from the day payment was confirmed. Cancelled and unpaid orders don't count.",
      "Change the date range at the top, and export to a spreadsheet if you need to.",
    ],
  },
  "/admin/staff": {
    title: "Staff",
    tips: [
      "Invite teammates by email and give each only the role they need.",
      "Everyone must set up two-factor sign-in before they can use the admin.",
    ],
  },
  "/admin/audit": {
    title: "Audit log",
    tips: [
      "Every staff change and system action, newest first.",
      "Entries can't be edited or deleted, so you can always see who did what.",
    ],
  },
  "/admin/system": {
    title: "System",
    tips: [
      "Background jobs and incoming webhooks.",
      "Jobs retry by themselves. Only worry about ones listed as failed.",
    ],
  },
  "/admin/settings": {
    title: "Settings",
    tips: [
      "Shipping, cash on delivery and tax rules for the shop.",
      "Changes apply to new orders only. Orders already placed keep their terms.",
    ],
  },
}

const FALLBACK: PageTips = {
  title: "Admin",
  tips: [
    "Use the menu to get to your tools, or press ⌘K (Ctrl K) to search.",
    "Saved changes show a message at the top of the screen.",
  ],
}

function segments(path: string): string[] {
  return path.split("/").filter(Boolean)
}

/** How well a pattern fits a path: -1 for no match, higher is more specific. */
function score(pattern: string, path: string[]): number {
  const parts = segments(pattern)
  if (parts.length > path.length) return -1
  // The dashboard's tips are for the dashboard only, not every admin page.
  if (parts.length === 1 && path.length > 1) return -1
  let points = 0
  for (const [i, part] of parts.entries()) {
    if (part === "*") points += 1
    else if (part === path[i]) points += 2
    else return -1
  }
  // A pattern that covers the whole path beats a shorter prefix.
  return points * 10 + (parts.length === path.length ? 5 : 0)
}

/** The PAGE_TIPS pattern for a path, or null when none fits. */
export function patternFor(pathname: string): string | null {
  const path = segments(pathname.split(/[?#]/)[0] ?? "")
  let best: string | null = null
  let bestScore = -1
  for (const pattern of Object.keys(PAGE_TIPS)) {
    const points = score(pattern, path)
    if (points > bestScore) {
      best = pattern
      bestScore = points
    }
  }
  return best
}

export function tipsFor(pathname: string): PageTips {
  const pattern = patternFor(pathname)
  return pattern ? PAGE_TIPS[pattern]! : FALLBACK
}
