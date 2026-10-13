-- 017_marketplace_analytics_and_operational_alerts.sql
-- Enforces auditable source-of-truth marketplace operations, supply coverage metrics, and operational alerts

CREATE TABLE IF NOT EXISTS marketplace_operational_alerts (
  id varchar(64) PRIMARY KEY,
  alert_type varchar(64) NOT NULL,
  severity varchar(32) NOT NULL,
  status varchar(32) NOT NULL DEFAULT 'ACTIVE',
  title text NOT NULL,
  description text NOT NULL,
  vertical_slug varchar(64),
  neighbourhood varchar(128),
  metrics_payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by_user_id uuid REFERENCES users(id),
  resolved_at timestamptz,
  resolved_by_user_id uuid REFERENCES users(id),
  resolution_notes text
);

CREATE INDEX IF NOT EXISTS idx_operational_alerts_status_severity ON marketplace_operational_alerts(status, severity);
CREATE INDEX IF NOT EXISTS idx_operational_alerts_created_at ON marketplace_operational_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_operational_alerts_vertical_neighbourhood ON marketplace_operational_alerts(vertical_slug, neighbourhood);

CREATE TABLE IF NOT EXISTS marketplace_analytics_snapshots (
  id varchar(64) PRIMARY KEY,
  snapshot_time timestamptz NOT NULL DEFAULT now(),
  time_window varchar(32) NOT NULL,
  vertical_slug varchar(64),
  neighbourhood varchar(128),
  metrics jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_time_window ON marketplace_analytics_snapshots(time_window, snapshot_time DESC);
