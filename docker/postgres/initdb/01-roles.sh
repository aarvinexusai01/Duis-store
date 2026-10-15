#!/usr/bin/env bash
# Runs once, when the official postgres image initialises an empty data
# directory. Creates the cluster-wide least-privilege roles from
# doc/05-database-design.md; per-database setup is in 02-database.sql.
#   duis_owner    owns the public schema; used only by migrations (DDL)
#   duis_app      runtime role for web and worker (DML); owns the pgboss schema
#   duis_readonly reporting and backup verification
set -euo pipefail

: "${DUIS_OWNER_PASSWORD:?DUIS_OWNER_PASSWORD must be set}"
: "${DUIS_APP_PASSWORD:?DUIS_APP_PASSWORD must be set}"
: "${DUIS_READONLY_PASSWORD:?DUIS_READONLY_PASSWORD must be set}"

psql --set ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --set owner_password="$DUIS_OWNER_PASSWORD" \
  --set app_password="$DUIS_APP_PASSWORD" \
  --set readonly_password="$DUIS_READONLY_PASSWORD" <<'SQL'
CREATE ROLE duis_owner LOGIN PASSWORD :'owner_password';
CREATE ROLE duis_app LOGIN PASSWORD :'app_password';
CREATE ROLE duis_readonly LOGIN PASSWORD :'readonly_password';

ALTER ROLE duis_app SET statement_timeout = '15s';
ALTER ROLE duis_readonly SET default_transaction_read_only = on;
SQL
