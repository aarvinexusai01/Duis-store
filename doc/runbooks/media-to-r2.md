# Moving media to R2

Today, processed images live on the `media` volume and Nginx serves them,
with Cloudflare caching them at the edge. That holds up well into tens of
GB. Move them when the volume threatens the server's disk, or before adding
a second server.

**This needs code first.** Image URLs are built as `/media/<key>/<file>` by
`src/lib/image-loader.ts`, and uploads are written by
`src/server/storage/local.ts`. Before moving anything:

1. Add a storage adapter that writes renditions to an R2 bucket (S3 API). Keep the same keys.
2. Add a `MEDIA_BASE_URL` setting used by the image loader, e.g. `https://media.<domain>`.
3. Make the media library's "delete" remove objects from the bucket.

Then, with that released:
1. Create a **separate** public bucket, `duis-media`. Never the backup bucket. Connect it to `media.<domain>` (R2 → Settings → Custom domain), with a cache rule caching everything.
2. Copy the volume to the bucket:

   ```sh
   docker run --rm -v duis_media:/data:ro rclone/rclone \
     copy /data r2:duis-media
   ```

   Configure the rclone remote with an R2 token, and keep that token for this job only.
3. Set `MEDIA_BASE_URL`, and switch uploads to the adapter, both in `.env.production`. Then deploy.
4. Copy once more to catch uploads made during the switch.
5. Keep the volume (and its nightly restic copy) for a month, then stop backing it up and remove it.

The private files (shipping labels) stay on the server's `private` volume.
