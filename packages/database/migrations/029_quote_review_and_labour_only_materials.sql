-- 029_quote_review_and_labour_only_materials.sql
-- Migration for Issue #13 (SH-12): Quote review, call-out fee and labour-only materials

ALTER TABLE "quotes"
  ADD COLUMN IF NOT EXISTS "diagnostic_fee_cents" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "labor_subtotal_cents" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "materials_subtotal_cents" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "disposal_subtotal_cents" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "permits_subtotal_cents" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "customer_supplied_parts_caveat" TEXT,
  ADD COLUMN IF NOT EXISTS "customer_supplied_acknowledged" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "decline_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "declined_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "declined_by" UUID REFERENCES "users"("id");

ALTER TABLE "quote_items"
  ADD COLUMN IF NOT EXISTS "is_customer_supplied" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "warranty_caveat" TEXT;

ALTER TABLE "change_orders"
  ADD COLUMN IF NOT EXISTS "diagnostic_fee_cents" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "labor_subtotal_cents" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "materials_subtotal_cents" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "disposal_subtotal_cents" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "permits_subtotal_cents" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "customer_supplied_parts_caveat" TEXT,
  ADD COLUMN IF NOT EXISTS "customer_supplied_acknowledged" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "decline_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "declined_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "declined_by" UUID REFERENCES "users"("id"),
  ADD COLUMN IF NOT EXISTS "customer_acknowledged_at" TIMESTAMPTZ;

ALTER TABLE "change_order_items"
  ADD COLUMN IF NOT EXISTS "is_customer_supplied" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "warranty_caveat" TEXT;

CREATE INDEX IF NOT EXISTS "idx_quotes_job_status_version" ON "quotes" ("job_id", "status", "version");
CREATE INDEX IF NOT EXISTS "idx_change_orders_job_status" ON "change_orders" ("job_id", "status");
