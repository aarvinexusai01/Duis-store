#!/usr/bin/env bash
# Runs once, when the official postgres image initialises an empty data
# directory. Creates the least-privilege roles from doc/05-database-design.md:
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
  --set dbname="$POSTGRES_DB" \
  --set owner_password="$DUIS_OWNER_PASSWORD" \
  --set app_password="$DUIS_APP_PASSWORD" \
  --set readonly_password="$DUIS_READONLY_PASSWORD" <<'SQL'
CREATE ROLE duis_owner LOGIN PASSWORD :'owner_password';
CREATE ROLE duis_app LOGIN PASSWORD :'app_password';
CREATE ROLE duis_readonly LOGIN PASSWORD :'readonly_password';

ALTER DATABASE :"dbname" OWNER TO duis_owner;
REVOKE ALL ON DATABASE :"dbname" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"dbname" TO duis_app, duis_readonly;

-- Application tables: DDL only through migrations (duis_owner).
ALTER SCHEMA public OWNER TO duis_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO duis_app, duis_readonly;

ALTER DEFAULT PRIVILEGES FOR ROLE duis_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO duis_app;
ALTER DEFAULT PRIVILEGES FOR ROLE duis_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO duis_app;
ALTER DEFAULT PRIVILEGES FOR ROLE duis_owner IN SCHEMA public
  GRANT SELECT ON TABLES TO duis_readonly;

-- Job queue: pg-boss installs, migrates and maintains (including background
-- index builds) its own schema, so the runtime role owns it.
-- See doc/adr/0015-job-queue-and-database-roles.md.
CREATE SCHEMA pgboss AUTHORIZATION duis_app;
GRANT USAGE ON SCHEMA pgboss TO duis_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE duis_app IN SCHEMA pgboss
  GRANT SELECT ON TABLES TO duis_readonly;

ALTER ROLE duis_app SET statement_timeout = '15s';
ALTER ROLE duis_readonly SET default_transaction_read_only = on;
SQL
