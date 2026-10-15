-- Migration 021: Production Identity, MFA, Session Management, and Abuse Protection (SH-03)

-- 1. Extend users table with verification flags and contact details
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(32);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT false;

-- 2. User Sessions (Refresh tokens, session tracking, device telemetry)
CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash VARCHAR(64) NOT NULL UNIQUE,
  session_version INTEGER NOT NULL DEFAULT 1,
  ip_address VARCHAR(64),
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_refresh_token_hash ON user_sessions(refresh_token_hash);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);

-- 3. User MFA Devices (TOTP Authenticator & Backup Codes)
CREATE TABLE IF NOT EXISTS user_mfa_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method VARCHAR(32) NOT NULL DEFAULT 'TOTP',
  secret TEXT NOT NULL,
  label VARCHAR(128) NOT NULL DEFAULT 'Authenticator App',
  verified BOOLEAN NOT NULL DEFAULT false,
  backup_codes_hash JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_mfa_devices_user_id ON user_mfa_devices(user_id);

-- 4. User MFA Login Challenges (Short-lived challenges for 2FA logins)
CREATE TABLE IF NOT EXISTS user_mfa_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_token VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_mfa_challenges_token ON user_mfa_challenges(challenge_token);

-- 5. User Password Resets (Cryptographic reset tokens with 1-hour lease)
CREATE TABLE IF NOT EXISTS user_password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_password_resets_token_hash ON user_password_resets(token_hash);

-- 6. User Email Verifications (Cryptographic email verification tokens)
CREATE TABLE IF NOT EXISTS user_email_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_email_verifications_token_hash ON user_email_verifications(token_hash);

-- 7. Distributed Auth Rate Limiting & Brute Force Lockout
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(128) NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 1,
  locked_until TIMESTAMPTZ,
  first_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_key ON auth_rate_limits(key);
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_locked_until ON auth_rate_limits(locked_until);
