-- Per-database setup, run as a superuser in the target database.
-- Executed by the postgres image on first start (for POSTGRES_DB) and by the
-- integration-test setup for its throwaway database. Safe to re-run.

DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I OWNER TO duis_owner', current_database());
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format(
    'GRANT CONNECT, TEMPORARY ON DATABASE %I TO duis_app, duis_readonly',
    current_database()
  );
END
$$;

-- Application tables: DDL only through migrations (duis_owner).
ALTER SCHEMA public OWNER TO duis_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO duis_app, duis_readonly;

ALTER DEFAULT PRIVILEGES FOR ROLE duis_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO duis_app;
ALTER DEFAULT PRIVILEGES FOR ROLE duis_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO duis_app;
ALTER DEFAULT PRIVILEGES FOR ROLE duis_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO duis_app;
ALTER DEFAULT PRIVILEGES FOR ROLE duis_owner IN SCHEMA public
  GRANT SELECT ON TABLES TO duis_readonly;

-- Job queue: pg-boss installs, migrates and maintains (including background
-- index builds) its own schema, so the runtime role owns it.
-- See doc/adr/0015-job-queue-and-database-roles.md.
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION duis_app;
GRANT USAGE ON SCHEMA pgboss TO duis_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE duis_app IN SCHEMA pgboss
  GRANT SELECT ON TABLES TO duis_readonly;

-- Extensions are installed by the superuser; migrations assume they exist.
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fuzzy search, autocomplete
CREATE EXTENSION IF NOT EXISTS unaccent;  -- accent-insensitive search
CREATE EXTENSION IF NOT EXISTS ltree;     -- category tree paths
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive SKUs, emails, codes
