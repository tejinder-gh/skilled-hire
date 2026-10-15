-- Migration 022: Technician Service Recommendations and Homeowner Response Lifecycle

-- 1. Create enum types for recommendations
DO $$ BEGIN
  CREATE TYPE recommendation_urgency AS ENUM (
    'IMMEDIATE_SAFETY_HAZARD',
    'URGENT_REPAIR',
    'RECOMMENDED_MAINTENANCE',
    'UPGRADE_OPPORTUNITY'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE recommendation_status AS ENUM (
    'PROPOSED',
    'ACCEPTED',
    'DECLINED',
    'DEFERRED',
    'CONVERTED',
    'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE recommendation_decline_reason AS ENUM (
    'TOO_EXPENSIVE',
    'WILL_DO_LATER',
    'DIY_OR_OWN_CONTRACTOR',
    'NOT_NEEDED',
    'SELLING_HOME',
    'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2. Service Recommendations Table
CREATE TABLE IF NOT EXISTS service_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  service_request_id UUID NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
  technician_id UUID NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  vertical_id UUID REFERENCES verticals(id) ON DELETE SET NULL,
  category_id UUID REFERENCES service_categories(id) ON DELETE SET NULL,
  urgency recommendation_urgency NOT NULL DEFAULT 'RECOMMENDED_MAINTENANCE',
  status recommendation_status NOT NULL DEFAULT 'PROPOSED',
  estimated_cost_cents BIGINT NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'CAD',
  evidence_photos JSONB NOT NULL DEFAULT '[]'::jsonb,
  homeowner_response_notes TEXT,
  decline_reason recommendation_decline_reason,
  responded_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  converted_service_request_id UUID REFERENCES service_requests(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recommendations_job_id ON service_recommendations(job_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_customer_id ON service_recommendations(customer_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_property_id ON service_recommendations(property_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_contractor_id ON service_recommendations(contractor_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_technician_id ON service_recommendations(technician_id);
CREATE INDEX IF NOT EXISTS idx_recommendations_status ON service_recommendations(status);

-- 3. Service Recommendation Response & Audit History Table
CREATE TABLE IF NOT EXISTS service_recommendation_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID NOT NULL REFERENCES service_recommendations(id) ON DELETE CASCADE,
  action VARCHAR(32) NOT NULL,
  actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_role VARCHAR(32) NOT NULL,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recommendation_responses_rec_id ON service_recommendation_responses(recommendation_id);
CREATE INDEX IF NOT EXISTS idx_recommendation_responses_actor_id ON service_recommendation_responses(actor_id);
CREATE INDEX IF NOT EXISTS idx_recommendation_responses_created_at ON service_recommendation_responses(created_at);
