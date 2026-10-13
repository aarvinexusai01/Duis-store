-- Extensions are installed once by the superuser at initialisation; app
-- migrations assume they exist (see doc/05-database-design.md §1).
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fuzzy search, autocomplete
CREATE EXTENSION IF NOT EXISTS unaccent;  -- accent-insensitive search
CREATE EXTENSION IF NOT EXISTS ltree;     -- category tree paths
CREATE EXTENSION IF NOT EXISTS citext;    -- case-insensitive SKUs, emails, coupon codes
