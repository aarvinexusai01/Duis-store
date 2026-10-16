-- Ledgers and order history are append-only for the app role (as in 0001).
REVOKE UPDATE, DELETE, TRUNCATE ON "order_status_history" FROM duis_app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "wallet_ledger" FROM duis_app;--> statement-breakpoint

-- The singleton commerce settings row with the values agreed in doc/01 and
-- doc/10 (2026-10-15): GST registered in Uttar Pradesh; international
-- destinations US, UK, UAE, Canada, Australia, Singapore and the EU.
INSERT INTO "store_settings" ("id", "registered_state_code", "international_country_codes")
VALUES (1, 'IN-UP', ARRAY['US','GB','AE','CA','AU','SG',
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT',
  'LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'])
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint

-- Apparel (HSN chapters 61 and 62): 5% when the value per piece before tax
-- is up to ₹2,500, 18% above (in force from 2025-09-22). Your CA must confirm
-- this interpretation (doc/10 A14) before launch.
INSERT INTO "tax_rules" ("hsn_prefix", "price_threshold_paise", "rate_below_bp", "rate_above_bp", "effective_from")
VALUES ('61', 250000, 500, 1800, '2025-09-22'),
       ('62', 250000, 500, 1800, '2025-09-22');
