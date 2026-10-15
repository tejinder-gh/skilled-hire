import type { Role } from "./index.js";

export interface UserSummary {
  id: string;
  email: string;
  displayName: string;
  roles: readonly Role[];
  emailVerified?: boolean;
}

export interface UserSessionDto {
  id: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string;
  expiresAt: string;
  isCurrent?: boolean;
}

export interface SignupInput {
  email: string;
  password: string;
  displayName: string;
  role?: Role;
  phoneNumber?: string;
}

export interface SignupResult {
  user: UserSummary;
  accessToken: string;
  refreshToken: string;
  emailVerificationPending: boolean;
  emailVerificationToken?: string;
}

export interface LoginInput {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export type LoginResult =
  | {
      mfaRequired: true;
      challengeToken: string;
      maskedMethod: string;
      roles: readonly Role[];
    }
  | {
      mfaRequired: false;
      accessToken: string;
      refreshToken: string;
      roles: readonly Role[];
      user: UserSummary;
      session: UserSessionDto;
    };

export interface MfaSetupResponse {
  secret: string;
  otpauthUrl: string;
  backupCodes: readonly string[];
}

export interface MfaConfirmSetupInput {
  code: string;
}

export interface MfaConfirmSetupResponse {
  success: boolean;
  message: string;
}

export interface MfaVerifyInput {
  challengeToken: string;
  code: string;
}

export interface MfaVerifyResponse {
  accessToken: string;
  refreshToken: string;
  roles: readonly Role[];
  user: UserSummary;
  session: UserSessionDto;
}

export interface RefreshTokenInput {
  refreshToken?: string;
}

export interface RefreshTokenResult {
  accessToken: string;
  refreshToken: string;
  sessionVersion: number;
}

export interface PasswordResetRequestInput {
  email: string;
}

export interface PasswordResetRequestResult {
  success: boolean;
  message: string;
  resetToken?: string;
}

export interface PasswordResetConfirmInput {
  token: string;
  newPassword: string;
}

export interface PasswordResetConfirmResult {
  success: boolean;
  message: string;
}

export interface EmailVerificationInput {
  token: string;
}

export interface EmailVerificationResult {
  success: boolean;
  message: string;
}

export interface CsrfTokenResponse {
  csrfToken: string;
}

export interface RateLimitStatus {
  key: string;
  attempts: number;
  maxAttempts: number;
  lockedUntil?: string | null;
}
