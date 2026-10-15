-- Append-only history (doc/05 §1): the runtime role may insert and read these
-- tables but never rewrite or remove rows.
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM duis_app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "inventory_movements" FROM duis_app;
