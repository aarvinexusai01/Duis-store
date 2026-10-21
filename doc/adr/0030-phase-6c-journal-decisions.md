# ADR-0030: Phase 6c, the Journal

- Status: Accepted
- Date: 2026-10-21
- Deciders: On 2026-10-21 the owner chose:
  - "The Journal" at `/journal`;
  - shoppable product blocks, YouTube and Instagram embeds;
  - author profiles;
  - no comments.

## Decisions

### Stories on the shared workflow

**Decision.**
- A story is a fourth CMS content target (`blog_post`), with autosave, review, scheduling, publishing, history, restore and preview exactly as pages, menus and settings.
- Its content is a revision:
  - title, excerpt, cover, author, category, tags and search settings;
  - a body of blocks: text (the shared rich-text subset), image with caption, shoppable products (up to 8), YouTube and Instagram.
- On publish, the listing fields (title, excerpt, cover, author, category, reading time) and tags are copied onto `blog_posts` / `blog_post_tags`, so lists, filters and the feed don't parse revisions.
- A story keeps its first publication date; later edits don't redate it.

**Why.**
- One workflow everywhere, as decided for 6b.
- Blocks keep embeds and products out of free HTML.
- Copying listing fields keeps the Journal fast.

### Embeds

**Decision.**
- **YouTube:** stored as a video ID. The page shows a play button and loads nothing from Google until it's pressed, then plays from `youtube-nocookie.com`.
- **Instagram:** stored as a canonical post or reel URL. Instagram's script sets tracking cookies, so it loads only after marketing consent. Before that, readers get a link to open it on Instagram.
- Links are parsed in the editor, and the server accepts only those exact forms.

**Why.**
- It honours the 5c consent rules (nothing tracking before consent).
- It avoids arbitrary iframes.

### Shoppable products

**Decision.**
- A products block shows live product cards (price, stock, wishlist).
- A story's cache is also invalidated by catalogue changes, so prices stay current.
- Missing or archived products drop out of the block.

**Why.** Readers can buy the look without stale prices.

### Authors and taxonomy

**Decision.**
- Authors are profiles (name, address, bio, photo), optionally linked to a staff account, so guest writers work.
- Managers edit authors and categories. Editors may add tags while writing.
- Changing an author's or category's address adds a redirect.
- An author, category or tag used by any story, draft or live, can't be deleted.

**Why.** These are the owner's choices, and they match the in-use rule from 6b.

### Discovery

**Decision.**
- `/journal` leads with the newest story, then shows a grid, category tabs and pagination.
- Category, tag and author pages exist.
- RSS 2.0 at `/journal/rss.xml` carries the latest 30 stories.
- Sitemap entries cover the Journal, its categories and every story.
- Stories carry `BlogPosting` structured data.
- "Hide from search engines" also keeps a story out of the feed and sitemap.
- There are no comments.

**Why.** Search and feed readers are the main ways new readers arrive. Comments would need moderation the owner chose not to take on.

## Consequences

- **Content:** add at least one author under Journal → Authors, categories and tags before writing.
- **Menus:** link the Journal from the header or footer menu (a web-address link to `/journal`).
- **E2E:** covers publishing to both replicas and RSS, and the YouTube no-request rule.
