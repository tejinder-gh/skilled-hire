-- Migration 025: Append-Only Financial Ledger, Payout Holds, Milestone Evidence & Reconciliation (SH-08)

-- 1. Create Enums
DO $$ BEGIN
  CREATE TYPE ledger_entry_type AS ENUM (
    'CUSTOMER_CHARGE',
    'APPLICATION_FEE',
    'CONTRACTOR_PAYOUT',
    'REFUND_DEBIT',
    'DISPUTE_HOLD',
    'PAYOUT_HOLD',
    'PAYOUT_RELEASE',
    'NEGATIVE_BALANCE_RECOVERY',
    'MANUAL_ADJUSTMENT'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE ledger_account_type AS ENUM (
    'CUSTOMER_RECEIVABLE',
    'PLATFORM_REVENUE',
    'CONTRACTOR_PAYABLE',
    'STRIPE_CLEARING',
    'DISPUTE_RESERVE',
    'PAYOUT_ESCROW_HOLD'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE payout_hold_reason AS ENUM (
    'MISSING_COMPLETION_EVIDENCE',
    'ACTIVE_DISPUTE',
    'COMPLIANCE_RESTRICTION',
    'QUALITY_AUDIT_SAMPLE',
    'NEGATIVE_CONTRACTOR_BALANCE',
    'MANUAL_RISK_HOLD'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE payout_hold_status AS ENUM (
    'ACTIVE',
    'RELEASED',
    'FORFEITED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE reconciliation_status AS ENUM (
    'BALANCED',
    'DISCREPANCY_DETECTED',
    'INVESTIGATING',
    'RESOLVED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Append-Only Financial Ledger
CREATE TABLE IF NOT EXISTS marketplace_financial_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type ledger_entry_type NOT NULL,
  account_type ledger_account_type NOT NULL,
  direction VARCHAR(6) NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
  currency CHAR(3) NOT NULL DEFAULT 'CAD',
  contractor_id UUID REFERENCES contractors(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  milestone_id UUID REFERENCES payment_milestones(id) ON DELETE SET NULL,
  transaction_id UUID REFERENCES payment_transactions(id) ON DELETE SET NULL,
  refund_id UUID REFERENCES refunds(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  running_balance_cents BIGINT NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_contractor ON marketplace_financial_ledger(contractor_id);
CREATE INDEX IF NOT EXISTS idx_ledger_job ON marketplace_financial_ledger(job_id);
CREATE INDEX IF NOT EXISTS idx_ledger_milestone ON marketplace_financial_ledger(milestone_id);
CREATE INDEX IF NOT EXISTS idx_ledger_type ON marketplace_financial_ledger(entry_type);
CREATE INDEX IF NOT EXISTS idx_ledger_created ON marketplace_financial_ledger(created_at);

-- 3. Payout Holds & Evidence Gates
CREATE TABLE IF NOT EXISTS payout_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  milestone_id UUID NOT NULL REFERENCES payment_milestones(id) ON DELETE CASCADE,
  amount_cents BIGINT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'CAD',
  hold_reason payout_hold_reason NOT NULL,
  hold_status payout_hold_status NOT NULL DEFAULT 'ACTIVE',
  required_evidence_type VARCHAR(64),
  evidence_attachment_id UUID REFERENCES file_attachments(id) ON DELETE SET NULL,
  placed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  released_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  release_notes TEXT,
  stripe_transfer_id VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payout_holds_contractor ON payout_holds(contractor_id);
CREATE INDEX IF NOT EXISTS idx_payout_holds_milestone ON payout_holds(milestone_id);
CREATE INDEX IF NOT EXISTS idx_payout_holds_status ON payout_holds(hold_status);

-- 4. Contractor Payout Balance Snapshot
CREATE TABLE IF NOT EXISTS contractor_payout_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contractor_id UUID NOT NULL UNIQUE REFERENCES contractors(id) ON DELETE CASCADE,
  available_balance_cents BIGINT NOT NULL DEFAULT 0,
  held_balance_cents BIGINT NOT NULL DEFAULT 0,
  lifetime_earnings_cents BIGINT NOT NULL DEFAULT 0,
  lifetime_payouts_cents BIGINT NOT NULL DEFAULT 0,
  is_negative BOOLEAN NOT NULL DEFAULT false,
  currency CHAR(3) NOT NULL DEFAULT 'CAD',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contractor_balance_contractor ON contractor_payout_balances(contractor_id);

-- 5. Financial Reconciliation Reports
CREATE TABLE IF NOT EXISTS financial_reconciliation_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date DATE NOT NULL,
  total_charges_cents BIGINT NOT NULL DEFAULT 0,
  total_platform_fees_cents BIGINT NOT NULL DEFAULT 0,
  total_contractor_payouts_cents BIGINT NOT NULL DEFAULT 0,
  total_refunds_cents BIGINT NOT NULL DEFAULT 0,
  total_active_holds_cents BIGINT NOT NULL DEFAULT 0,
  discrepancy_cents BIGINT NOT NULL DEFAULT 0,
  status reconciliation_status NOT NULL DEFAULT 'BALANCED',
  unreconciled_transaction_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  exception_notes TEXT,
  generated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_date ON financial_reconciliation_reports(report_date);
CREATE INDEX IF NOT EXISTS idx_reconciliation_status ON financial_reconciliation_reports(status);
