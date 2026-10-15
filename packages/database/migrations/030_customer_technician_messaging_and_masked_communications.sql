-- Migration: 030_customer_technician_messaging_and_masked_communications.sql
-- Implements customer-technician messaging, delivery receipts, content moderation,
-- and masked phone/SMS communications sessions (SH-14 / Issue #15).

CREATE TABLE IF NOT EXISTS job_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'READ_ONLY', 'CLOSED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS job_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES job_conversations(id) ON DELETE CASCADE,
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    sender_user_id UUID NOT NULL REFERENCES users(id),
    sender_role VARCHAR(32) NOT NULL,
    content TEXT NOT NULL,
    attachment_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'SENT' CHECK (status IN ('SENT', 'DELIVERED', 'READ', 'FAILED')),
    moderation_status VARCHAR(32) NOT NULL DEFAULT 'CLEAN' CHECK (moderation_status IN ('CLEAN', 'FLAGGED', 'BLOCKED')),
    moderation_reason TEXT,
    idempotency_key VARCHAR(128),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    read_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS masked_communication_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
    virtual_proxy_number VARCHAR(32) NOT NULL DEFAULT '+16475550199',
    session_extension VARCHAR(16) NOT NULL,
    session_pin VARCHAR(16) NOT NULL,
    customer_user_id UUID NOT NULL REFERENCES users(id),
    technician_user_id UUID NOT NULL REFERENCES users(id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at TIMESTAMPTZ NOT NULL,
    call_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance and retrieval indexes
CREATE INDEX IF NOT EXISTS idx_job_messages_job_created ON job_messages(job_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_job_messages_conversation ON job_messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_job_messages_sender ON job_messages(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_masked_comm_job_active ON masked_communication_sessions(job_id, is_active);
CREATE INDEX IF NOT EXISTS idx_masked_comm_pin ON masked_communication_sessions(virtual_proxy_number, session_extension, session_pin);
