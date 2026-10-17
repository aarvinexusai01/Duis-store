# ADR-0028: Phase 6a page builder, workflow, preview and scheduling

- Status: Accepted
- Date: 2026-10-17
- Deciders: On 2026-10-17 the owner chose:
  - Phase 6 in three slices: this one, then media, navigation and settings (6b), then the blog (6c);
  - **Content Managers publish directly**, and Content Editors submit for review.

## Decisions

### A working draft, frozen into versions

**Decision.**
- Each page has one working draft. Autosave (about 1.5 seconds after a change) edits it in place: the data and its reference rows are replaced, and the version number stays the same.
- Submitting, scheduling or publishing freezes it. The next edit starts a new numbered version.
- Every save carries the draft's ID and last-saved time. If either has changed, the save is refused with "Someone else changed this page. Reload", so two editors never silently overwrite each other.
- While a version waits for review or for its scheduled time it is locked: the author withdraws it, or a manager cancels the schedule, to edit again.
- An invalid draft (a section missing a required image, say) is not saved. The builder marks the fields to fix, and the server checks the same rules.

**Why.**
- A new revision per keystroke would bury the history.
- Locking a submitted version means a manager always publishes exactly what they reviewed.

### Workflow and roles

**Decision.**
- Draft → in review → published or scheduled, or sent back with a note.
- The schema's "approved" status is not used: a reviewing manager publishes or schedules straight away, which matches the owner's choice.
- Unpublish and archive take a page offline and cancel any pending schedule. The home page can do neither.
- An unpublished page can be published again without an edit (as a new version).
- "Restore" copies any version into the working draft.
- Every transition writes an audit entry. Permissions:
  - `cms: draft` to edit, submit and withdraw;
  - `cms: review` to send back;
  - `cms: publish` to publish, schedule, cancel and unpublish;
  - `cms: archive` to archive and restore.

**Why.**
- These follow the roles in doc/08 and the owner's choice.
- Audited transitions give the history doc/06 asks for.

### Preview

**Decision.**
- Preview is a signed link, `/preview/<revision>.<expiry>.<HMAC>`, valid for 24 hours with no sign-in needed. It renders that revision with the storefront's own resolver and block components, under the normal header and footer.
- It has no analytics, is excluded from search engines, and may be framed only by our own origin (for the builder's side-by-side desktop and mobile view).
- Next.js draft mode is not used.

**Why.**
- A signed link can be sent to someone without an admin account.
- Rendering through the same components guarantees the preview matches the live page.
- Draft mode would flip the whole site into uncached rendering for that browser.

### Scheduling

**Decision.**
- `cms.publish-scheduled` runs every minute (stately) and publishes each due revision on its own through the normal publish path, as the system actor. Publishing clears the caches on every replica.
- Times are entered in IST and stored in UTC.
- A schedule must be at least one minute and at most one year ahead.

**Why.**
- pg-boss schedules have one-minute resolution, which is "on time" for a shop.
- Publishing each revision separately means one bad revision can't hold back the others.

### Proving the exit criterion

**Decision.**
- Playwright now starts a second web replica (port 3102) and a worker limited by `WORKER_QUEUES=cache.revalidate`.
- `WORKER_QUEUES` is a new, opt-in worker setting; production leaves it unset.
- The CMS spec publishes twice and checks that both replicas serve the change within 10 seconds.
- No other worker may share the database during E2E: one with different replica URLs would take some jobs and fail them, delaying the retries.

**Why.** "Both replicas within 10 seconds" can only be shown with two replicas and the real fan-out path.

## Consequences

- **E2E:** run `npm run build && npm run build:server` first, and stop any development worker.
- **Not yet:**
  - review emails (pending reviews show as a count on the pages list);
  - navigation and site-settings editors, the media library, redirects and policy pages (6b).
- **Dependency:** dnd-kit (`@dnd-kit/core` 6.3, `@dnd-kit/sortable` 10) for drag and drop, with the keyboard sensor for accessibility, and up/down buttons as well.
