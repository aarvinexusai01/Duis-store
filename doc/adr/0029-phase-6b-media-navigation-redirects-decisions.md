# ADR-0029: Phase 6b menus, site settings, media library and redirects

- Status: Accepted
- Date: 2026-10-21
- Deciders: On 2026-10-17 the owner chose:
  - **Redirects:** automatic when an address changes, plus a manager.
  - **Menus and site settings** follow the same workflow as pages.
  - **In-use content** can never be deleted; staff see where it's used.

## Decisions

### One workflow for every kind of content

**Decision.**
- The 6a page workflow now acts on a *content target*: a page, a menu (`header`, `footer`) or the site settings.
- Each target has a row that points at its working draft and live revision (`cms_pages`, `navigation_menus`, `site_settings`), its own validation schema, and its own reference rules.
- Autosave, submit, withdraw, send back, publish, schedule, history, restore and preview are shared. Page-only actions (rename, change address, unpublish, archive) live in `pages-admin.ts`.
- Audit actions are `cms.<page|navigation|settings>.<action>`.
- The admin editors share one shell (status, buttons, preview, history) and an autosave hook.

**Why.**
- The owner wanted menus and settings reviewed like pages.
- One implementation keeps the rules identical, and the blog (6c) slots in the same way.

### Menus

**Decision.**
- The header menu is items → columns → links, each linking to a category, collection, page or web address, with an optional badge. A top item may carry a promo image, shown beside its mega menu.
- The footer menu is columns → links.
- The mobile menu reuses the header. Social links come from site settings, so the `mobile` and `social` menu keys aren't edited.
- Items are reordered with up/down buttons.

**Why.** It matches what the storefront renders today. Buttons are accessible and fine for menus of this size.

### Previews of menus and settings

**Decision.**
- A menu or settings draft is previewed around the live home page: the preview page draws the header and footer itself, passing the draft to them.
- The preview layout no longer adds its own chrome.

**Why.** A menu or settings change only makes sense in context.

### Site settings

**Decision.**
- Settings cover brand name, tagline, logo (replaces the text wordmark in the header), favicon, announcement bar, contact details, social links, grievance officer and default SEO.
- The favicon is served by `/brand/icon`: the uploaded image, or a generated "D" monogram. It's linked from the root metadata.

**Why.**
- Staff can rebrand without a deployment.
- The site previously had no favicon at all.

### Redirects

**Decision.**
- A `redirects` table maps old paths to new ones.
- **Matching:** lower case, no trailing slash, query string passed on.
- **Automatic redirects:**
  - Changing the address of a page, product or collection that has been live adds a permanent redirect.
  - Renaming or moving a category redirects it and every category inside it. This is recorded after the change commits, because the tree is read fresh.
  - Chains collapse on write, so visitors never hop twice.
  - New content at an old address takes the address back.
- **Staff redirects** (Content Managers):
  - may be temporary;
  - can't point at themselves or loop through another redirect;
  - can't take over the home page or the app's own areas (`/admin`, `/api`, `/checkout`, `/account`, …).
- **Serving:** the request proxy answers with a real 301 or 302. It keeps the table in memory and reloads it every 30 seconds, never waiting on the database after the first load and keeping the last copy if the database is unreachable. Hits are counted after the response has gone (`waitUntil`).

**Why.**
- Search engines need a true 301.
- Next.js advises against sharing state between the proxy and render code, so the proxy owns its own copy. 30 seconds is an acceptable delay for a new redirect.

### In-use content and "where used"

**Decision.**
- Deleting an image is refused while a product, category, collection, or a live or pending page, menu or settings version uses it.
- Archiving a collection is refused while a live or pending page or menu uses it.
- Both errors name what uses it (`used by Page "Drop", Menu "Header menu"`). The media library shows the full list with links.

**Why.** It's the owner's choice, and it meets the Phase 6 exit criterion. Naming the users tells staff exactly what to fix.

### Media library and focal points

**Decision.**
- The media library offers:
  - grid or list, search, and an "unused" filter;
  - multi-file upload with per-file progress;
  - alt text, caption and focal point (click on the image);
  - a "where used" list, and delete.
- Focal points now apply to CMS images and banners (`object-position`). Product cards come from the listing cache and still centre.

**Why.**
- Staff need to keep the important part of an image in view when banners and tiles crop it.
- Changing product cards would mean changing the listing cache. That's left for later.

### Pages and SEO

**Decision.**
- New pages can be policy pages, which show "Last updated" (their publish date).
- Pages have an optional canonical address in their SEO settings.
- Page addresses can be changed by managers, with an automatic redirect once the page has been live.

**Why.** Policies must show when they last changed. Campaign duplicates need a canonical.

## Consequences

- **E2E:** covers menus reaching both replicas, the proxy redirect on both replicas, and the media library. No other worker may share the database during E2E.
- **Not yet:** focal points on product cards; review emails; blog (6c).
