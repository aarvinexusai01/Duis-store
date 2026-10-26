# syntax=docker/dockerfile:1.12
#
# One image for the web app, the worker and the migrate job.
#   docker build --build-arg APP_SHA=$(git rev-parse --short=12 HEAD) -t duis-web:<sha> .
#   web:     node server.js            (default command)
#   worker:  node dist/worker.mjs
#   migrate: node dist/migrate.mjs
ARG NODE_IMAGE=node:24.21.0-trixie-slim

FROM ${NODE_IMAGE} AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# --- dependencies: cached until package-lock.json changes -------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# --- build ------------------------------------------------------------------
FROM base AS build
ARG APP_SHA=dev
# Browser error reporting is baked in at build time (the DSN is public);
# empty leaves Sentry out of the browser entirely.
ARG NEXT_PUBLIC_SENTRY_DSN=""
ARG APP_ENV=production
# Version-skew protection while old and new replicas overlap.
ENV NEXT_DEPLOYMENT_ID=${APP_SHA} \
    NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN} \
    NEXT_PUBLIC_APP_ENV=${APP_ENV} \
    NEXT_PUBLIC_APP_SHA=${APP_SHA}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Every build must use the same Server Actions key so actions keep working
# during a rolling deploy. Optional for local builds:
#   --secret id=next_server_actions_key,env=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
RUN --mount=type=secret,id=next_server_actions_key,env=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY \
    npm run build

# --- runtime ----------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ARG APP_SHA=dev
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--enable-source-maps \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    MIGRATIONS_DIR=/app/migrations \
    APP_SHA=${APP_SHA}
WORKDIR /app

# Application files stay root-owned (read-only for the app user); only the
# Next.js cache and the data folders (volumes in compose.yaml) are writable.
# A new named volume copies these owners, so the app user can write to it.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/db/migrations ./migrations
RUN mkdir -p .next/cache /data/media /data/private \
 && chown node:node .next/cache /data/media /data/private

USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/api/health`).then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server.js"]
