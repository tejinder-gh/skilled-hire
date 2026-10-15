import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// 1. Enums
export const userRoleEnum = pgEnum("user_role", [
  "CUSTOMER",
  "CONTRACTOR_OWNER",
  "CONTRACTOR_MANAGER",
  "TECHNICIAN",
  "OPERATIONS_AGENT",
  "DISPATCHER",
  "SUPPORT_AGENT",
  "QUOTE_REVIEWER",
  "ADMIN",
  "SUPER_ADMIN",
]);

export const requestStatusEnum = pgEnum("request_status", [
  "DRAFT",
  "SUBMITTED",
  "QUALIFICATION_PENDING",
  "QUALIFIED",
  "SCHEDULING",
  "SCHEDULED",
  "CONTRACTOR_SEARCH",
  "ASSIGNED",
  "TECHNICIAN_EN_ROUTE",
  "TECHNICIAN_ARRIVED",
  "ASSESSMENT_IN_PROGRESS",
  "QUOTE_PENDING",
  "QUOTE_SUBMITTED",
  "QUOTE_APPROVED",
  "QUOTE_REJECTED",
  "MATERIALS_PENDING",
  "WORK_SCHEDULED",
  "WORK_IN_PROGRESS",
  "ON_HOLD",
  "CHANGE_ORDER_PENDING",
  "COMPLETION_PENDING",
  "COMPLETED",
  "CANCELLED",
  "DISPUTED",
  "CLOSED",
]);

export const verificationStatusEnum = pgEnum("verification_status", [
  "PENDING",
  "VERIFIED",
  "REJECTED",
  "EXPIRED",
  "SUSPENDED",
]);

export const quoteStatusEnum = pgEnum("quote_status", [
  "DRAFT",
  "SUBMITTED",
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
  "SUPERSEDED",
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "PENDING",
  "REQUIRES_ACTION",
  "PAID",
  "FAILED",
  "REFUNDED",
  "WAIVED",
]);

export const connectOnboardingStatusEnum = pgEnum("connect_onboarding_status", [
  "NOT_STARTED",
  "IN_PROGRESS",
  "PENDING_VERIFICATION",
  "COMPLETED",
  "RESTRICTED",
]);

export const paymentIntentStatusEnum = pgEnum("payment_intent_status", [
  "REQUIRES_PAYMENT_METHOD",
  "REQUIRES_CONFIRMATION",
  "REQUIRES_ACTION",
  "PROCESSING",
  "SUCCEEDED",
  "CANCELED",
  "FAILED",
]);

export const webhookEventStatusEnum = pgEnum("webhook_event_status", [
  "RECEIVED",
  "PROCESSING",
  "PROCESSED",
  "FAILED",
  "IGNORED",
]);

export const disputeStatusEnum = pgEnum("dispute_status", [
  "NEEDS_RESPONSE",
  "UNDER_REVIEW",
  "WON",
  "LOST",
]);

export const ledgerEntryTypeEnum = pgEnum("ledger_entry_type", [
  "CUSTOMER_CHARGE",
  "APPLICATION_FEE",
  "CONTRACTOR_PAYOUT",
  "REFUND_DEBIT",
  "DISPUTE_HOLD",
  "PAYOUT_HOLD",
  "PAYOUT_RELEASE",
  "NEGATIVE_BALANCE_RECOVERY",
  "MANUAL_ADJUSTMENT",
]);

export const ledgerAccountTypeEnum = pgEnum("ledger_account_type", [
  "CUSTOMER_RECEIVABLE",
  "PLATFORM_REVENUE",
  "CONTRACTOR_PAYABLE",
  "STRIPE_CLEARING",
  "DISPUTE_RESERVE",
  "PAYOUT_ESCROW_HOLD",
]);

export const payoutHoldReasonEnum = pgEnum("payout_hold_reason", [
  "MISSING_COMPLETION_EVIDENCE",
  "ACTIVE_DISPUTE",
  "COMPLIANCE_RESTRICTION",
  "QUALITY_AUDIT_SAMPLE",
  "NEGATIVE_CONTRACTOR_BALANCE",
  "MANUAL_RISK_HOLD",
]);

export const payoutHoldStatusEnum = pgEnum("payout_hold_status", [
  "ACTIVE",
  "RELEASED",
  "FORFEITED",
]);

export const reconciliationStatusEnum = pgEnum("reconciliation_status", [
  "BALANCED",
  "DISCREPANCY_DETECTED",
  "INVESTIGATING",
  "RESOLVED",
]);

export const changeOrderStatusEnum = pgEnum("change_order_status", [
  "DRAFT",
  "SUBMITTED",
  "ACCEPTED",
  "DECLINED",
  "EXPIRED",
  "SUPERSEDED",
]);

export const supportStatusEnum = pgEnum("support_status", [
  "OPEN",
  "INVESTIGATING",
  "WAITING_CUSTOMER",
  "WAITING_CONTRACTOR",
  "RESOLVED",
  "CLOSED",
]);

export const notificationChannelEnum = pgEnum("notification_channel", [
  "IN_APP",
  "EMAIL",
  "SMS",
  "PUSH",
  "PHONE",
]);

export const outboxStatusEnum = pgEnum("outbox_status", [
  "PENDING",
  "PROCESSING",
  "DELIVERED",
  "RETRYING",
  "DEAD_LETTER",
  "CANCELLED_PREFERENCE",
]);

export const notificationPreferenceCategoryEnum = pgEnum(
  "notification_preference_category",
  [
    "DISPATCH_ALERTS",
    "TRANSACTIONAL_RECEIPTS",
    "JOB_MILESTONES",
    "MARKETING_PROMOTIONS",
    "SAFETY_EMERGENCY",
  ],
);

export const recommendationUrgencyEnum = pgEnum("recommendation_urgency", [
  "IMMEDIATE_SAFETY_HAZARD",
  "URGENT_REPAIR",
  "RECOMMENDED_MAINTENANCE",
  "UPGRADE_OPPORTUNITY",
]);

export const recommendationStatusEnum = pgEnum("recommendation_status", [
  "PROPOSED",
  "ACCEPTED",
  "DECLINED",
  "DEFERRED",
  "CONVERTED",
  "CANCELLED",
]);

export const recommendationDeclineReasonEnum = pgEnum(
  "recommendation_decline_reason",
  [
    "TOO_EXPENSIVE",
    "WILL_DO_LATER",
    "DIY_OR_OWN_CONTRACTOR",
    "NOT_NEEDED",
    "SELLING_HOME",
    "OTHER",
  ],
);

export const fileScanStatusEnum = pgEnum("file_scan_status", [
  "PENDING_SCAN",
  "CLEAN",
  "QUARANTINED",
  "REJECTED",
]);

export const fileAttachmentStatusEnum = pgEnum("file_attachment_status", [
  "INITIATED",
  "UPLOADED",
  "ACTIVE",
  "DELETED",
  "QUARANTINED",
]);

export const fileVisibilityEnum = pgEnum("file_visibility", [
  "PRIVATE",
  "CUSTOMER_VISIBLE",
  "CONTRACTOR_VISIBLE",
  "SHARED",
  "INTERNAL_ONLY",
]);

// 2. Core Identity & RBAC
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  phoneNumber: varchar("phone_number", { length: 32 }),
  phoneVerified: boolean("phone_verified").notNull().default(false),
  mfaRequired: boolean("mfa_required").notNull().default(false),
  sessionVersion: integer("session_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: userRoleEnum("role").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.role] })],
);

export const userSessions = pgTable("user_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  refreshTokenHash: varchar("refresh_token_hash", { length: 64 })
    .notNull()
    .unique(),
  sessionVersion: integer("session_version").notNull().default(1),
  ipAddress: varchar("ip_address", { length: 64 }),
  userAgent: text("user_agent"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userMfaDevices = pgTable("user_mfa_devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  method: varchar("method", { length: 32 }).notNull().default("TOTP"),
  secret: text("secret").notNull(),
  label: varchar("label", { length: 128 }).notNull().default("Authenticator App"),
  verified: boolean("verified").notNull().default(false),
  backupCodesHash: jsonb("backup_codes_hash").notNull().default([]),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userMfaChallenges = pgTable("user_mfa_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  challengeToken: varchar("challenge_token", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userPasswordResets = pgTable("user_password_resets", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const userEmailVerifications = pgTable("user_email_verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const authRateLimits = pgTable("auth_rate_limits", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: varchar("key", { length: 128 }).notNull().unique(),
  attempts: integer("attempts").notNull().default(1),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// File Evidence Pipeline & Quarantine (SH-04)
export const fileAttachments = pgTable("file_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  storageKey: varchar("storage_key", { length: 255 }).notNull().unique(),
  ownerUserId: uuid("owner_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  contractorId: uuid("contractor_id").references(() => contractors.id, {
    onDelete: "set null",
  }),
  customerId: uuid("customer_id").references(() => users.id, {
    onDelete: "set null",
  }),
  jobId: uuid("job_id").references(() => jobs.id, {
    onDelete: "set null",
  }),
  serviceRequestId: uuid("service_request_id").references(
    () => serviceRequests.id,
    { onDelete: "set null" },
  ),
  fileCategory: varchar("file_category", { length: 64 }).notNull(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 128 }).notNull(),
  byteSize: bigint("byte_size", { mode: "number" }).notNull().default(0),
  sha256Checksum: varchar("sha256_checksum", { length: 64 }),
  scanStatus: fileScanStatusEnum("scan_status").notNull().default("PENDING_SCAN"),
  quarantineReason: text("quarantine_reason"),
  visibility: fileVisibilityEnum("visibility").notNull().default("SHARED"),
  status: fileAttachmentStatusEnum("status").notNull().default("INITIATED"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const fileQuarantineEvents = pgTable("file_quarantine_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileId: uuid("file_id")
    .notNull()
    .references(() => fileAttachments.id, { onDelete: "cascade" }),
  triggerReason: text("trigger_reason").notNull(),
  detectedSignatures: jsonb("detected_signatures").notNull().default([]),
  resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionNotes: text("resolution_notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// 3. Service Taxonomy & Catalog
export const verticals = pgTable("verticals", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  family: text("family").notNull().default("GENERAL"),
  description: text("description"),
  icon: text("icon"),
  riskTier: text("risk_tier").notNull().default("MODERATE"),
  permitAuthority: text("permit_authority"),
  launchReady: boolean("launch_ready").notNull().default(false),
  displayOrder: integer("display_order").notNull().default(100),
  config: jsonb("config").notNull().default({}),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const serviceCategories = pgTable(
  "service_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    verticalId: uuid("vertical_id")
      .notNull()
      .references(() => verticals.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    riskTier: text("risk_tier").notNull().default("MODERATE"),
    launchReady: boolean("launch_ready").notNull().default(false),
    displayOrder: integer("display_order").notNull().default(100),
    active: boolean("active").notNull().default(true),
  },
  (table) => [
    unique("service_categories_vertical_id_slug_key").on(
      table.verticalId,
      table.slug,
    ),
  ],
);

export const issueTypes = pgTable(
  "issue_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => serviceCategories.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    scopeSummary: text("scope_summary"),
    riskTier: text("risk_tier").notNull().default("MODERATE"),
    pricingType: text("pricing_type").notNull().default("HOURLY"),
    basePriceCents: bigint("base_price_cents", { mode: "number" })
      .notNull()
      .default(0),
    defaultDurationMinutes: integer("default_duration_minutes")
      .notNull()
      .default(120),
    requiresPermit: boolean("requires_permit").notNull().default(false),
    permitType: text("permit_type"),
    requiredEvidence: jsonb("required_evidence")
      .notNull()
      .default(["before_photo", "after_photo"]),
    defaultWarrantyMonths: integer("default_warranty_months")
      .notNull()
      .default(12),
    geographicRestrictions: jsonb("geographic_restrictions")
      .notNull()
      .default(["ON"]),
    tags: jsonb("tags").notNull().default([]),
    equipmentFields: jsonb("equipment_fields").notNull().default([]),
    launchReady: boolean("launch_ready").notNull().default(false),
    displayOrder: integer("display_order").notNull().default(100),
    active: boolean("active").notNull().default(true),
  },
  (table) => [
    unique("issue_types_category_id_slug_key").on(table.categoryId, table.slug),
  ],
);

// 4. Customer Properties
export const properties = pgTable(
  "properties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => users.id),
    label: text("label").notNull(),
    addressLine1: text("address_line1").notNull(),
    city: text("city").notNull(),
    region: text("region").notNull(),
    postalCode: text("postal_code").notNull(),
    propertyType: text("property_type").notNull().default("DETACHED"),
    unitNumber: text("unit_number"),
    accessNotes: text("access_notes"),
    isPrimary: boolean("is_primary").notNull().default(false),
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_properties_customer_primary").on(
      table.customerId,
      table.isPrimary,
    ),
  ],
);

// 5. Contractors & Technicians
export const contractors = pgTable("contractors", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerUserId: uuid("owner_user_id")
    .notNull()
    .references(() => users.id),
  name: text("name").notNull(),
  status: verificationStatusEnum("status").notNull().default("PENDING"),
  ratingBps: integer("rating_bps").notNull().default(0),
  completionRateBps: integer("completion_rate_bps").notNull().default(0),
  avgResponseMinutes: integer("avg_response_minutes").notNull().default(1440),
  serviceAreas: jsonb("service_areas").notNull().default([]),
  verticalIds: jsonb("vertical_ids").notNull().default([]),
  safetyStatus: text("safety_status").notNull().default("ACTIVE"),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspensionReason: text("suspension_reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const technicians = pgTable("technicians", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id),
  contractorId: uuid("contractor_id")
    .notNull()
    .references(() => contractors.id),
  displayName: text("display_name").notNull(),
  active: boolean("active").notNull().default(true),
  emergencyAvailable: boolean("emergency_available").notNull().default(false),
  workload: integer("workload").notNull().default(0),
  latitude: numeric("latitude", { precision: 9, scale: 6 }),
  longitude: numeric("longitude", { precision: 9, scale: 6 }),
  safetyStatus: text("safety_status").notNull().default("ACTIVE"),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspensionReason: text("suspension_reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const credentials = pgTable("credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractorId: uuid("contractor_id").references(() => contractors.id),
  technicianId: uuid("technician_id").references(() => technicians.id),
  code: text("code").notNull(),
  geography: text("geography").notNull().default("*"),
  status: verificationStatusEnum("status").notNull().default("PENDING"),
  verificationSource: text("verification_source")
    .notNull()
    .default("SELF_UPLOAD"),
  verifiedByUserId: uuid("verified_by_user_id").references(() => users.id),
  regulatorReference: text("regulator_reference"),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  limitations: text("limitations"),
  auditorNotes: text("auditor_notes"),
  expiryDate: date("expiry_date"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  documentKey: text("document_key"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const availabilityBlocks = pgTable("availability_blocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  technicianId: uuid("technician_id")
    .notNull()
    .references(() => technicians.id),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  available: boolean("available").notNull().default(true),
});

// 6. Service Requests & Jobs
export const serviceRequests = pgTable("service_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => users.id),
  propertyId: uuid("property_id")
    .notNull()
    .references(() => properties.id),
  verticalId: uuid("vertical_id")
    .notNull()
    .references(() => verticals.id),
  categoryId: uuid("category_id")
    .notNull()
    .references(() => serviceCategories.id),
  issueTypeId: uuid("issue_type_id")
    .notNull()
    .references(() => issueTypes.id),
  urgency: text("urgency").notNull(),
  status: requestStatusEnum("status").notNull().default("DRAFT"),
  description: text("description").notNull(),
  equipment: jsonb("equipment").notNull().default({}),
  preferredStartsAt: timestamp("preferred_starts_at", { withTimezone: true }),
  preferredEndsAt: timestamp("preferred_ends_at", { withTimezone: true }),
  attachmentKeys: jsonb("attachment_keys").notNull().default([]),
  riskTier: text("risk_tier").notNull().default("LOW"),
  riskScore: integer("risk_score"),
  riskAssessmentId: uuid("risk_assessment_id"),
  riskReviewStatus: text("risk_review_status").notNull().default("NOT_REQUIRED"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const jobs = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  serviceRequestId: uuid("service_request_id")
    .notNull()
    .unique()
    .references(() => serviceRequests.id),
  contractorId: uuid("contractor_id")
    .notNull()
    .references(() => contractors.id),
  technicianId: uuid("technician_id")
    .notNull()
    .references(() => technicians.id),
  status: requestStatusEnum("status").notNull(),
  evidenceSnapshot: jsonb("evidence_snapshot").notNull().default({}),
  workerIdentityVerified: boolean("worker_identity_verified")
    .notNull()
    .default(false),
  workerIdentityVerifiedAt: timestamp("worker_identity_verified_at", {
    withTimezone: true,
  }),
  workerIdentityMethod: text("worker_identity_method"),
  workerIdentityNotes: text("worker_identity_notes"),
  assignedJurisdiction: text("assigned_jurisdiction").notNull().default("ON"),
  assignedScope: jsonb("assigned_scope").notNull().default({}),
  permitRequired: boolean("permit_required").notNull().default(false),
  regulatorySignOffStatus: text("regulatory_sign_off_status")
    .notNull()
    .default("NOT_APPLICABLE"),
  certificateOfAcceptanceNumber: text("certificate_of_acceptance_number"),
  regulatorySignedOffAt: timestamp("regulatory_signed_off_at", {
    withTimezone: true,
  }),
  riskTier: text("risk_tier").notNull().default("LOW"),
  riskScore: integer("risk_score"),
  riskAssessmentId: uuid("risk_assessment_id").references(
    (): AnyPgColumn => jobRiskAssessments.id,
  ),
  riskReviewStatus: text("risk_review_status")
    .notNull()
    .default("NOT_REQUIRED"),
  assignedAt: timestamp("assigned_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  scheduledStartsAt: timestamp("scheduled_starts_at", { withTimezone: true }),
  scheduledEndsAt: timestamp("scheduled_ends_at", { withTimezone: true }),
  travelBufferMinutes: integer("travel_buffer_minutes").default(30),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// 7. Quotes & Payment Schedules
export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    version: integer("version").notNull(),
    status: quoteStatusEnum("status").notNull().default("DRAFT"),
    contractorSubtotalCents: bigint("contractor_subtotal_cents", {
      mode: "number",
    })
      .notNull()
      .default(0),
    diagnosticFeeCents: bigint("diagnostic_fee_cents", { mode: "number" })
      .notNull()
      .default(0),
    laborSubtotalCents: bigint("labor_subtotal_cents", { mode: "number" })
      .notNull()
      .default(0),
    materialsSubtotalCents: bigint("materials_subtotal_cents", { mode: "number" })
      .notNull()
      .default(0),
    disposalSubtotalCents: bigint("disposal_subtotal_cents", { mode: "number" })
      .notNull()
      .default(0),
    permitsSubtotalCents: bigint("permits_subtotal_cents", { mode: "number" })
      .notNull()
      .default(0),
    customerSuppliedPartsCaveat: text("customer_supplied_parts_caveat"),
    customerSuppliedAcknowledged: boolean("customer_supplied_acknowledged")
      .notNull()
      .default(false),
    platformFeeCents: bigint("platform_fee_cents", { mode: "number" })
      .notNull()
      .default(0),
    discountCents: bigint("discount_cents", { mode: "number" })
      .notNull()
      .default(0),
    taxCents: bigint("tax_cents", { mode: "number" }).notNull().default(0),
    customerTotalCents: bigint("customer_total_cents", { mode: "number" })
      .notNull()
      .default(0),
    currency: char("currency", { length: 3 }).notNull().default("CAD"),
    notes: text("notes"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: uuid("accepted_by").references(() => users.id),
    declineReason: text("decline_reason"),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    declinedBy: uuid("declined_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_quotes_job_status_version").on(table.jobId, table.status, table.version),
  ],
);

export const quoteItems = pgTable("quote_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  quoteId: uuid("quote_id")
    .notNull()
    .references(() => quotes.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  quantity: integer("quantity").notNull(),
  unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull(),
  subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull(),
  isCustomerSupplied: boolean("is_customer_supplied").notNull().default(false),
  warrantyCaveat: text("warranty_caveat"),
  materialMetadata: jsonb("material_metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const paymentRules = pgTable("payment_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  verticalId: uuid("vertical_id")
    .notNull()
    .references(() => verticals.id),
  minAmountCents: bigint("min_amount_cents", { mode: "number" }).notNull(),
  maxAmountCents: bigint("max_amount_cents", { mode: "number" }),
  rule: jsonb("rule").notNull(),
  active: boolean("active").notNull().default(true),
});

export const paymentSchedules = pgTable("payment_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  quoteId: uuid("quote_id")
    .notNull()
    .unique()
    .references(() => quotes.id),
  totalCents: bigint("total_cents", { mode: "number" }).notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const paymentMilestones = pgTable("payment_milestones", {
  id: uuid("id").primaryKey().defaultRandom(),
  scheduleId: uuid("schedule_id")
    .notNull()
    .references(() => paymentSchedules.id),
  sequence: integer("sequence").notNull(),
  triggerName: text("trigger_name").notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  evidenceRequired: boolean("evidence_required").notNull().default(false),
  status: paymentStatusEnum("status").notNull().default("PENDING"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
});

export const paymentTransactions = pgTable("payment_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  milestoneId: uuid("milestone_id")
    .notNull()
    .references(() => paymentMilestones.id),
  provider: text("provider").notNull(),
  providerReference: text("provider_reference").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  status: paymentStatusEnum("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Stripe Connect Sandbox & Payment Intents (SH-07)
export const stripeConnectAccounts = pgTable("stripe_connect_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractorId: uuid("contractor_id")
    .notNull()
    .unique()
    .references(() => contractors.id, { onDelete: "cascade" }),
  stripeAccountId: varchar("stripe_account_id", { length: 128 })
    .notNull()
    .unique(),
  accountType: varchar("account_type", { length: 32 })
    .notNull()
    .default("express"),
  onboardingStatus: connectOnboardingStatusEnum("onboarding_status")
    .notNull()
    .default("NOT_STARTED"),
  chargesEnabled: boolean("charges_enabled").notNull().default(false),
  payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
  detailsSubmitted: boolean("details_submitted").notNull().default(false),
  country: varchar("country", { length: 2 }).notNull().default("CA"),
  defaultCurrency: varchar("default_currency", { length: 3 })
    .notNull()
    .default("CAD"),
  requirementsDue: jsonb("requirements_due").notNull().default([]),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const customerPaymentMethods = pgTable("customer_payment_methods", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  stripePaymentMethodId: varchar("stripe_payment_method_id", { length: 128 })
    .notNull()
    .unique(),
  brand: varchar("brand", { length: 32 }).notNull(),
  last4: varchar("last4", { length: 4 }).notNull(),
  expMonth: integer("exp_month").notNull(),
  expYear: integer("exp_year").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const paymentIntents = pgTable("payment_intents", {
  id: uuid("id").primaryKey().defaultRandom(),
  milestoneId: uuid("milestone_id")
    .notNull()
    .references(() => paymentMilestones.id, { onDelete: "restrict" }),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  contractorId: uuid("contractor_id")
    .notNull()
    .references(() => contractors.id, { onDelete: "restrict" }),
  stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 128 })
    .notNull()
    .unique(),
  stripeClientSecret: varchar("stripe_client_secret", { length: 255 }).notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  currency: char("currency", { length: 3 }).notNull().default("CAD"),
  applicationFeeAmountCents: bigint("application_fee_amount_cents", {
    mode: "number",
  })
    .notNull()
    .default(0),
  status: paymentIntentStatusEnum("status")
    .notNull()
    .default("REQUIRES_PAYMENT_METHOD"),
  idempotencyKey: varchar("idempotency_key", { length: 255 })
    .notNull()
    .unique(),
  failureCode: varchar("failure_code", { length: 64 }),
  failureMessage: text("failure_message"),
  receiptUrl: text("receipt_url"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const stripeWebhookEvents = pgTable("stripe_webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: varchar("event_id", { length: 128 }).notNull().unique(),
  eventType: varchar("event_type", { length: 128 }).notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 255 }),
  payload: jsonb("payload").notNull(),
  status: webhookEventStatusEnum("status").notNull().default("RECEIVED"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const paymentDisputes = pgTable("payment_disputes", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id").references(
    () => paymentTransactions.id,
    { onDelete: "set null" },
  ),
  stripeDisputeId: varchar("stripe_dispute_id", { length: 128 })
    .notNull()
    .unique(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  currency: char("currency", { length: 3 }).notNull().default("CAD"),
  status: disputeStatusEnum("status").notNull().default("NEEDS_RESPONSE"),
  reason: varchar("reason", { length: 128 }).notNull(),
  evidenceDueBy: timestamp("evidence_due_by", { withTimezone: true }),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

// Append-Only Financial Ledger & Payout Holds (SH-08)
export const marketplaceFinancialLedger = pgTable(
  "marketplace_financial_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entryType: ledgerEntryTypeEnum("entry_type").notNull(),
    accountType: ledgerAccountTypeEnum("account_type").notNull(),
    direction: varchar("direction", { length: 6 }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("CAD"),
    contractorId: uuid("contractor_id").references(() => contractors.id, {
      onDelete: "set null",
    }),
    customerId: uuid("customer_id").references(() => users.id, {
      onDelete: "set null",
    }),
    jobId: uuid("job_id").references(() => jobs.id, {
      onDelete: "set null",
    }),
    milestoneId: uuid("milestone_id").references(
      () => paymentMilestones.id,
      { onDelete: "set null" },
    ),
    transactionId: uuid("transaction_id").references(
      () => paymentTransactions.id,
      { onDelete: "set null" },
    ),
    refundId: uuid("refund_id").references(() => refunds.id, {
      onDelete: "set null",
    }),
    description: text("description").notNull(),
    runningBalanceCents: bigint("running_balance_cents", { mode: "number" })
      .notNull()
      .default(0),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const payoutHolds = pgTable("payout_holds", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractorId: uuid("contractor_id")
    .notNull()
    .references(() => contractors.id, { onDelete: "cascade" }),
  milestoneId: uuid("milestone_id")
    .notNull()
    .references(() => paymentMilestones.id, { onDelete: "cascade" }),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  currency: char("currency", { length: 3 }).notNull().default("CAD"),
  holdReason: payoutHoldReasonEnum("hold_reason").notNull(),
  holdStatus: payoutHoldStatusEnum("hold_status").notNull().default("ACTIVE"),
  requiredEvidenceType: varchar("required_evidence_type", { length: 64 }),
  evidenceAttachmentId: uuid("evidence_attachment_id").references(
    () => fileAttachments.id,
    { onDelete: "set null" },
  ),
  placedByUserId: uuid("placed_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  releasedByUserId: uuid("released_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  releaseNotes: text("release_notes"),
  stripeTransferId: varchar("stripe_transfer_id", { length: 128 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  releasedAt: timestamp("released_at", { withTimezone: true }),
});

export const contractorPayoutBalances = pgTable("contractor_payout_balances", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractorId: uuid("contractor_id")
    .notNull()
    .unique()
    .references(() => contractors.id, { onDelete: "cascade" }),
  availableBalanceCents: bigint("available_balance_cents", { mode: "number" })
    .notNull()
    .default(0),
  heldBalanceCents: bigint("held_balance_cents", { mode: "number" })
    .notNull()
    .default(0),
  lifetimeEarningsCents: bigint("lifetime_earnings_cents", { mode: "number" })
    .notNull()
    .default(0),
  lifetimePayoutsCents: bigint("lifetime_payouts_cents", { mode: "number" })
    .notNull()
    .default(0),
  isNegative: boolean("is_negative").notNull().default(false),
  currency: char("currency", { length: 3 }).notNull().default("CAD"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const financialReconciliationReports = pgTable(
  "financial_reconciliation_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportDate: date("report_date").notNull(),
    totalChargesCents: bigint("total_charges_cents", { mode: "number" })
      .notNull()
      .default(0),
    totalPlatformFeesCents: bigint("total_platform_fees_cents", {
      mode: "number",
    })
      .notNull()
      .default(0),
    totalContractorPayoutsCents: bigint("total_contractor_payouts_cents", {
      mode: "number",
    })
      .notNull()
      .default(0),
    totalRefundsCents: bigint("total_refunds_cents", { mode: "number" })
      .notNull()
      .default(0),
    totalActiveHoldsCents: bigint("total_active_holds_cents", { mode: "number" })
      .notNull()
      .default(0),
    discrepancyCents: bigint("discrepancy_cents", { mode: "number" })
      .notNull()
      .default(0),
    status: reconciliationStatusEnum("status").notNull().default("BALANCED"),
    unreconciledTransactionIds: jsonb("unreconciled_transaction_ids")
      .notNull()
      .default([]),
    exceptionNotes: text("exception_notes"),
    generatedBy: uuid("generated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

// 8. Service Records, Reviews, Audits
export const serviceRecords = pgTable("service_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id")
    .notNull()
    .references(() => properties.id),
  jobId: uuid("job_id")
    .notNull()
    .unique()
    .references(() => jobs.id),
  verticalId: uuid("vertical_id")
    .notNull()
    .references(() => verticals.id),
  summary: text("summary").notNull(),
  equipment: jsonb("equipment").notNull().default({}),
  permitId: uuid("permit_id").references(() => electricalPermits.id),
  certificateOfAcceptanceNumber: text("certificate_of_acceptance_number"),
  regulatorySignOffStatus: text("regulatory_sign_off_status")
    .notNull()
    .default("NOT_APPLICABLE"),
  documentationPackageId: uuid("documentation_package_id").references(
    (): AnyPgColumn => jobDocumentationPackages.id,
    { onDelete: "set null" },
  ),
  riskTier: text("risk_tier").default("LOW"),
  qaAuditStatus: text("qa_audit_status").notNull().default("NOT_SAMPLED"),
  safetySignOffStatus: text("safety_sign_off_status")
    .notNull()
    .default("NOT_REQUIRED"),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const reviews = pgTable("reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id")
    .notNull()
    .unique()
    .references(() => jobs.id),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => users.id),
  overall: smallint("overall").notNull(),
  quality: smallint("quality"),
  professionalism: smallint("professionalism"),
  timeliness: smallint("timeliness"),
  communication: smallint("communication"),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id").references(() => users.id),
  actorType: text("actor_type").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  beforeState: jsonb("before_state"),
  afterState: jsonb("after_state"),
  metadata: jsonb("metadata").notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const processedWebhooks = pgTable(
  "processed_webhooks",
  {
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.provider, table.eventId] })],
);

export const idempotencyKeys = pgTable("idempotency_keys", {
  key: text("key").primaryKey(),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => users.id),
  requestHash: text("request_hash").notNull(),
  response: jsonb("response"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const riskEvents = pgTable("risk_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(),
  customerId: uuid("customer_id").references(() => users.id),
  contractorId: uuid("contractor_id").references(() => contractors.id),
  jobId: uuid("job_id").references(() => jobs.id),
  score: integer("score").notNull().default(0),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
});

// 9. Change Orders, Invoices, Disputes, Warranties
export const propertySystems = pgTable("property_systems", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id")
    .notNull()
    .references(() => properties.id),
  verticalId: uuid("vertical_id")
    .notNull()
    .references(() => verticals.id),
  name: text("name").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  installedOn: date("installed_on"),
  assetType: text("asset_type").default("GENERAL_EQUIPMENT"),
  manufacturer: text("manufacturer"),
  modelNumber: text("model_number"),
  serialNumber: text("serial_number"),
  warrantyStatus: text("warranty_status").default("ACTIVE"),
  lastServiceRecordId: uuid("last_service_record_id").references(
    (): AnyPgColumn => serviceRecords.id,
    { onDelete: "set null" },
  ),
  lastServicedAt: timestamp("last_serviced_at", { withTimezone: true }),
  installedByContractorId: uuid("installed_by_contractor_id").references(
    (): AnyPgColumn => contractors.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const warranties = pgTable("warranties", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertySystemId: uuid("property_system_id").references(
    () => propertySystems.id,
  ),
  serviceRecordId: uuid("service_record_id").references(
    () => serviceRecords.id,
  ),
  providerName: text("provider_name").notNull(),
  warrantyType: text("warranty_type").notNull(),
  startsOn: date("starts_on"),
  expiresOn: date("expires_on"),
  termsUrl: text("terms_url"),
  status: text("status").notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const changeOrders = pgTable(
  "change_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    version: integer("version").notNull(),
    status: changeOrderStatusEnum("status").notNull().default("DRAFT"),
    reason: text("reason").notNull(),
    explanation: text("explanation").notNull(),
    attachmentKeys: jsonb("attachment_keys").notNull().default([]),
    contractorSubtotalCents: bigint("contractor_subtotal_cents", {
      mode: "number",
    })
      .notNull()
      .default(0),
    diagnosticFeeCents: bigint("diagnostic_fee_cents", { mode: "number" })
      .notNull()
      .default(0),
    laborSubtotalCents: bigint("labor_subtotal_cents", { mode: "number" })
      .notNull()
      .default(0),
    materialsSubtotalCents: bigint("materials_subtotal_cents", { mode: "number" })
      .notNull()
      .default(0),
    disposalSubtotalCents: bigint("disposal_subtotal_cents", { mode: "number" })
      .notNull()
      .default(0),
    permitsSubtotalCents: bigint("permits_subtotal_cents", { mode: "number" })
      .notNull()
      .default(0),
    customerSuppliedPartsCaveat: text("customer_supplied_parts_caveat"),
    customerSuppliedAcknowledged: boolean("customer_supplied_acknowledged")
      .notNull()
      .default(false),
    platformFeeCents: bigint("platform_fee_cents", { mode: "number" })
      .notNull()
      .default(0),
    taxCents: bigint("tax_cents", { mode: "number" }).notNull().default(0),
    customerTotalCents: bigint("customer_total_cents", { mode: "number" })
      .notNull()
      .default(0),
    currency: char("currency", { length: 3 }).notNull().default("CAD"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: uuid("accepted_by").references(() => users.id),
    declineReason: text("decline_reason"),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    declinedBy: uuid("declined_by").references(() => users.id),
    customerAcknowledgedAt: timestamp("customer_acknowledged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_change_orders_job_status").on(table.jobId, table.status),
  ],
);

export const changeOrderItems = pgTable("change_order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  changeOrderId: uuid("change_order_id")
    .notNull()
    .references(() => changeOrders.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  quantity: integer("quantity").notNull(),
  unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull(),
  subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull(),
  isCustomerSupplied: boolean("is_customer_supplied").notNull().default(false),
  warrantyCaveat: text("warranty_caveat"),
  materialMetadata: jsonb("material_metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id")
    .notNull()
    .unique()
    .references(() => jobs.id),
  invoiceNumber: text("invoice_number").notNull().unique(),
  subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull(),
  platformFeeCents: bigint("platform_fee_cents", { mode: "number" }).notNull(),
  taxCents: bigint("tax_cents", { mode: "number" }).notNull(),
  totalCents: bigint("total_cents", { mode: "number" }).notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  pdfKey: text("pdf_key"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const supportTickets = pgTable("support_tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").references(() => users.id),
  contractorId: uuid("contractor_id").references(() => contractors.id),
  jobId: uuid("job_id").references(() => jobs.id),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  status: supportStatusEnum("status").notNull().default("OPEN"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

export const disputes = pgTable("disputes", {
  id: uuid("id").primaryKey().defaultRandom(),
  supportTicketId: uuid("support_ticket_id")
    .notNull()
    .unique()
    .references(() => supportTickets.id),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => users.id),
  contractorId: uuid("contractor_id")
    .notNull()
    .references(() => contractors.id),
  status: supportStatusEnum("status").notNull().default("OPEN"),
  resolution: text("resolution"),
  refundDecisionCents: bigint("refund_decision_cents", { mode: "number" }),
  resolvedBy: uuid("resolved_by").references(() => users.id),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const disputeEvidence = pgTable("dispute_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  disputeId: uuid("dispute_id")
    .notNull()
    .references(() => disputes.id),
  submittedBy: uuid("submitted_by")
    .notNull()
    .references(() => users.id),
  attachmentKey: text("attachment_key").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  recipientUserId: uuid("recipient_user_id")
    .notNull()
    .references(() => users.id),
  channel: notificationChannelEnum("channel").notNull().default("IN_APP"),
  eventType: text("event_type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  payload: jsonb("payload").notNull().default({}),
  readAt: timestamp("read_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const domainEvents = pgTable("domain_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  aggregateType: text("aggregate_type").notNull(),
  aggregateId: uuid("aggregate_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
});

export const customerContractorRelationships = pgTable(
  "customer_contractor_relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => users.id),
    contractorId: uuid("contractor_id")
      .notNull()
      .references(() => contractors.id),
    acquisitionSource: text("acquisition_source").notNull(),
    firstPlatformJobId: uuid("first_platform_job_id")
      .notNull()
      .references(() => jobs.id),
    lastPlatformJobId: uuid("last_platform_job_id")
      .notNull()
      .references(() => jobs.id),
    repeatJobCount: integer("repeat_job_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const feeRules = pgTable("fee_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  verticalId: uuid("vertical_id").references(() => verticals.id),
  contractorId: uuid("contractor_id").references(() => contractors.id),
  relationshipStage: text("relationship_stage").notNull(),
  takeRateBps: integer("take_rate_bps").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const refunds = pgTable("refunds", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id")
    .notNull()
    .references(() => paymentTransactions.id),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  reason: text("reason").notNull(),
  status: paymentStatusEnum("status").notNull().default("PENDING"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const payouts = pgTable("payouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractorId: uuid("contractor_id")
    .notNull()
    .references(() => contractors.id),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  status: text("status").notNull(),
  eligibleAt: timestamp("eligible_at", { withTimezone: true }),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// 10. Compliance Standards & Evaluations
export const credentialGroups = pgTable("credential_groups", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  displayOrder: integer("display_order").notNull(),
  icon: text("icon").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const complianceStandards = pgTable("compliance_standards", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupCode: text("group_code")
    .notNull()
    .references(() => credentialGroups.code),
  credentialCode: text("credential_code").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  verticalSlug: text("vertical_slug").notNull().default("*"),
  geography: text("geography").notNull().default("*"),
  entityLevel: text("entity_level").notNull(),
  requirementLevel: text("requirement_level").notNull(),
  issuingAuthority: text("issuing_authority").notNull(),
  legalReference: text("legal_reference"),
  verificationMethod: text("verification_method").notNull(),
  validityPeriodMonths: integer("validity_period_months"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const complianceEvaluations = pgTable("compliance_evaluations", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractorId: uuid("contractor_id").references(() => contractors.id),
  technicianId: uuid("technician_id").references(() => technicians.id),
  applicantEmail: text("applicant_email"),
  verticalSlug: text("vertical_slug").notNull(),
  geography: text("geography").notNull(),
  overallStatus: text("overall_status").notNull(),
  scoreBps: integer("score_bps").notNull(),
  summary: jsonb("summary").notNull().default({}),
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// 11. Versioned Trade Regulatory Policies Matrix
export const tradeRegulatoryPolicies = pgTable(
  "trade_regulatory_policies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    verticalSlug: text("vertical_slug").notNull(),
    categorySlug: text("category_slug").notNull().default("*"),
    variantSlug: text("variant_slug").notNull().default("*"),
    geography: text("geography").notNull().default("ON"),
    policyVersion: integer("policy_version").notNull().default(1),
    contractorMandatoryCodes: jsonb("contractor_mandatory_codes")
      .notNull()
      .default([]),
    technicianMandatoryCodes: jsonb("technician_mandatory_codes")
      .notNull()
      .default([]),
    apprenticeEligible: boolean("apprentice_eligible").notNull().default(false),
    supervisorRatio: text("supervisor_ratio").default("1:1"),
    permitRequired: boolean("permit_required").notNull().default(false),
    inspectionAuthority: text("inspection_authority"),
    legalAuthorityDisclaimer: text("legal_authority_disclaimer").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("trade_regulatory_policies_version_uniq").on(
      table.verticalSlug,
      table.categorySlug,
      table.variantSlug,
      table.geography,
      table.policyVersion,
    ),
  ],
);

// 12. Contractor Technical Capability Assessments & Scoped Approval
export const contractorCapabilityAssessments = pgTable(
  "contractor_capability_assessments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contractorId: uuid("contractor_id")
      .notNull()
      .references(() => contractors.id, { onDelete: "cascade" }),
    issueTypeId: uuid("issue_type_id")
      .notNull()
      .references(() => issueTypes.id, { onDelete: "restrict" }),
    geography: text("geography").notNull().default("ON"),
    status: text("status").notNull().default("SUBMITTED"),
    complexityTier: text("complexity_tier").notNull().default("TIER_1_BASIC"),
    yearsExperience: integer("years_experience").notNull().default(0),
    maxJobValueCents: bigint("max_job_value_cents", { mode: "number" })
      .notNull()
      .default(250000),
    workSamples: jsonb("work_samples").notNull().default([]),
    references: jsonb("references").notNull().default([]),
    toolsEquipment: jsonb("tools_equipment").notNull().default([]),
    supervisedRequirements: jsonb("supervised_requirements")
      .notNull()
      .default({}),
    denialReasons: jsonb("denial_reasons").notNull().default([]),
    assessedByUserId: uuid("assessed_by_user_id").references(() => users.id),
    assessedAt: timestamp("assessed_at", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    decisionNotes: text("decision_notes"),
    appealHistory: jsonb("appeal_history").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("contractor_capability_assessment_uniq").on(
      table.contractorId,
      table.issueTypeId,
      table.geography,
    ),
  ],
);

// 13. Pre-Dispatch & Pre-Work Eligibility Checks History
export const dispatchEligibilityChecks = pgTable(
  "dispatch_eligibility_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceRequestId: uuid("service_request_id")
      .notNull()
      .references(() => serviceRequests.id, { onDelete: "cascade" }),
    contractorId: uuid("contractor_id")
      .notNull()
      .references(() => contractors.id, { onDelete: "cascade" }),
    technicianId: uuid("technician_id")
      .notNull()
      .references(() => technicians.id, { onDelete: "cascade" }),
    evaluationStage: text("evaluation_stage").notNull(),
    eligible: boolean("eligible").notNull(),
    failClosedReason: text("fail_closed_reason"),
    denyCodes: jsonb("deny_codes").notNull().default([]),
    evidenceSnapshot: jsonb("evidence_snapshot").notNull().default({}),
    evaluatedByUserId: uuid("evaluated_by_user_id").references(() => users.id),
    escalatedToOps: boolean("escalated_to_ops").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

// 14. Relational mappings
export const verticalsRelations = relations(verticals, ({ many }) => ({
  categories: many(serviceCategories),
}));

export const serviceCategoriesRelations = relations(
  serviceCategories,
  ({ one, many }) => ({
    vertical: one(verticals, {
      fields: [serviceCategories.verticalId],
      references: [verticals.id],
    }),
    issueTypes: many(issueTypes),
  }),
);

export const issueTypesRelations = relations(issueTypes, ({ one, many }) => ({
  category: one(serviceCategories, {
    fields: [issueTypes.categoryId],
    references: [serviceCategories.id],
  }),
  capabilityAssessments: many(contractorCapabilityAssessments),
}));

export const usersRelations = relations(users, ({ many, one }) => ({
  roles: many(userRoles),
  properties: many(properties),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
  }),
}));

export const contractorsRelations = relations(contractors, ({ one, many }) => ({
  owner: one(users, {
    fields: [contractors.ownerUserId],
    references: [users.id],
  }),
  technicians: many(technicians),
  credentials: many(credentials),
  capabilityAssessments: many(contractorCapabilityAssessments),
}));

export const contractorCapabilityAssessmentsRelations = relations(
  contractorCapabilityAssessments,
  ({ one }) => ({
    contractor: one(contractors, {
      fields: [contractorCapabilityAssessments.contractorId],
      references: [contractors.id],
    }),
    issueType: one(issueTypes, {
      fields: [contractorCapabilityAssessments.issueTypeId],
      references: [issueTypes.id],
    }),
    assessedBy: one(users, {
      fields: [contractorCapabilityAssessments.assessedByUserId],
      references: [users.id],
    }),
  }),
);

export const techniciansRelations = relations(technicians, ({ one, many }) => ({
  user: one(users, {
    fields: [technicians.userId],
    references: [users.id],
  }),
  contractor: one(contractors, {
    fields: [technicians.contractorId],
    references: [contractors.id],
  }),
  credentials: many(credentials),
  availabilityBlocks: many(availabilityBlocks),
}));

export const credentialsRelations = relations(credentials, ({ one }) => ({
  contractor: one(contractors, {
    fields: [credentials.contractorId],
    references: [contractors.id],
  }),
  technician: one(technicians, {
    fields: [credentials.technicianId],
    references: [technicians.id],
  }),
  verifiedBy: one(users, {
    fields: [credentials.verifiedByUserId],
    references: [users.id],
  }),
}));

export const propertiesRelations = relations(properties, ({ one, many }) => ({
  customer: one(users, {
    fields: [properties.customerId],
    references: [users.id],
  }),
  serviceRequests: many(serviceRequests),
  systems: many(propertySystems),
}));

export const serviceRequestsRelations = relations(
  serviceRequests,
  ({ one }) => ({
    customer: one(users, {
      fields: [serviceRequests.customerId],
      references: [users.id],
    }),
    property: one(properties, {
      fields: [serviceRequests.propertyId],
      references: [properties.id],
    }),
    vertical: one(verticals, {
      fields: [serviceRequests.verticalId],
      references: [verticals.id],
    }),
    category: one(serviceCategories, {
      fields: [serviceRequests.categoryId],
      references: [serviceCategories.id],
    }),
    issueType: one(issueTypes, {
      fields: [serviceRequests.issueTypeId],
      references: [issueTypes.id],
    }),
    job: one(jobs, {
      fields: [serviceRequests.id],
      references: [jobs.serviceRequestId],
    }),
    riskAssessment: one(jobRiskAssessments, {
      fields: [serviceRequests.riskAssessmentId],
      references: [jobRiskAssessments.id],
    }),
  }),
);

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  serviceRequest: one(serviceRequests, {
    fields: [jobs.serviceRequestId],
    references: [serviceRequests.id],
  }),
  contractor: one(contractors, {
    fields: [jobs.contractorId],
    references: [contractors.id],
  }),
  technician: one(technicians, {
    fields: [jobs.technicianId],
    references: [technicians.id],
  }),
  quotes: many(quotes),
  changeOrders: many(changeOrders),
  riskAssessment: one(jobRiskAssessments, {
    fields: [jobs.riskAssessmentId],
    references: [jobRiskAssessments.id],
  }),
}));

export const quotesRelations = relations(quotes, ({ one, many }) => ({
  job: one(jobs, {
    fields: [quotes.jobId],
    references: [jobs.id],
  }),
  items: many(quoteItems),
  paymentSchedule: one(paymentSchedules, {
    fields: [quotes.id],
    references: [paymentSchedules.quoteId],
  }),
}));

export const quoteItemsRelations = relations(quoteItems, ({ one }) => ({
  quote: one(quotes, {
    fields: [quoteItems.quoteId],
    references: [quotes.id],
  }),
}));

export const paymentSchedulesRelations = relations(
  paymentSchedules,
  ({ one, many }) => ({
    quote: one(quotes, {
      fields: [paymentSchedules.quoteId],
      references: [quotes.id],
    }),
    milestones: many(paymentMilestones),
  }),
);

export const paymentMilestonesRelations = relations(
  paymentMilestones,
  ({ one }) => ({
    schedule: one(paymentSchedules, {
      fields: [paymentMilestones.scheduleId],
      references: [paymentSchedules.id],
    }),
  }),
);

// 13. Safety Incidents, Actions, Quarantines & Quality Audits (#58)
export const safetyIncidents = pgTable("safety_incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  incidentNumber: text("incident_number").notNull().unique(),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
  serviceRequestId: uuid("service_request_id").references(
    () => serviceRequests.id,
    { onDelete: "set null" },
  ),
  propertyId: uuid("property_id").references(() => properties.id, {
    onDelete: "set null",
  }),
  contractorId: uuid("contractor_id")
    .notNull()
    .references(() => contractors.id, { onDelete: "restrict" }),
  technicianId: uuid("technician_id").references(() => technicians.id, {
    onDelete: "set null",
  }),
  reportedByUserId: uuid("reported_by_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  reporterRole: text("reporter_role").notNull(),
  severity: text("severity").notNull().default("MODERATE_DEFECT"),
  status: text("status").notNull().default("REPORTED"),
  incidentType: text("incident_type").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  reportedAt: timestamp("reported_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  containmentActions: jsonb("containment_actions").notNull().default([]),
  evidenceLocker: jsonb("evidence_locker").notNull().default([]),
  insurerNotified: boolean("insurer_notified").notNull().default(false),
  insurerNotifiedAt: timestamp("insurer_notified_at", { withTimezone: true }),
  insurerClaimReference: text("insurer_claim_reference"),
  legalRetentionHold: boolean("legal_retention_hold").notNull().default(false),
  quarantineScope: jsonb("quarantine_scope").notNull().default({}),
  triageNotes: text("triage_notes"),
  triagedByUserId: uuid("triaged_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  triagedAt: timestamp("triaged_at", { withTimezone: true }),
  independentReviewNotes: text("independent_review_notes"),
  reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  resolutionSummary: text("resolution_summary"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const safetyIncidentActions = pgTable("safety_incident_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  incidentId: uuid("incident_id")
    .notNull()
    .references(() => safetyIncidents.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  actionType: text("action_type").notNull(),
  previousStatus: text("previous_status"),
  newStatus: text("new_status"),
  actionPayload: jsonb("action_payload").notNull().default({}),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const contractorSafetyQuarantines = pgTable(
  "contractor_safety_quarantines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => safetyIncidents.id, { onDelete: "restrict" }),
    contractorId: uuid("contractor_id")
      .notNull()
      .references(() => contractors.id, { onDelete: "restrict" }),
    technicianId: uuid("technician_id").references(() => technicians.id, {
      onDelete: "set null",
    }),
    quarantineType: text("quarantine_type").notNull(),
    restrictedVerticalIds: jsonb("restricted_vertical_ids")
      .notNull()
      .default([]),
    restrictedIssueTypeIds: jsonb("restricted_issue_type_ids")
      .notNull()
      .default([]),
    active: boolean("active").notNull().default(true),
    reason: text("reason").notNull(),
    issuedByUserId: uuid("issued_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    liftedAt: timestamp("lifted_at", { withTimezone: true }),
    liftedByUserId: uuid("lifted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    liftingNotes: text("lifting_notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const qualityAudits = pgTable("quality_audits", {
  id: uuid("id").primaryKey().defaultRandom(),
  auditNumber: text("audit_number").notNull().unique(),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
  contractorId: uuid("contractor_id")
    .notNull()
    .references(() => contractors.id, { onDelete: "restrict" }),
  technicianId: uuid("technician_id").references(() => technicians.id, {
    onDelete: "set null",
  }),
  incidentId: uuid("incident_id").references(() => safetyIncidents.id, {
    onDelete: "set null",
  }),
  triggerType: text("trigger_type").notNull(),
  inspectorUserId: uuid("inspector_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  status: text("status").notNull().default("SCHEDULED"),
  findings: jsonb("findings").notNull().default([]),
  repeatDefectCount: integer("repeat_defect_count").notNull().default(0),
  remediationRequired: boolean("remediation_required").notNull().default(false),
  remediationDeadline: timestamp("remediation_deadline", { withTimezone: true }),
  remediationCompletedAt: timestamp("remediation_completed_at", {
    withTimezone: true,
  }),
  reportNotes: text("report_notes"),
  conductedAt: timestamp("conducted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const safetyIncidentsRelations = relations(
  safetyIncidents,
  ({ one, many }) => ({
    contractor: one(contractors, {
      fields: [safetyIncidents.contractorId],
      references: [contractors.id],
    }),
    technician: one(technicians, {
      fields: [safetyIncidents.technicianId],
      references: [technicians.id],
    }),
    job: one(jobs, {
      fields: [safetyIncidents.jobId],
      references: [jobs.id],
    }),
    serviceRequest: one(serviceRequests, {
      fields: [safetyIncidents.serviceRequestId],
      references: [serviceRequests.id],
    }),
    property: one(properties, {
      fields: [safetyIncidents.propertyId],
      references: [properties.id],
    }),
    reportedByUser: one(users, {
      fields: [safetyIncidents.reportedByUserId],
      references: [users.id],
    }),
    actions: many(safetyIncidentActions),
    quarantines: many(contractorSafetyQuarantines),
    audits: many(qualityAudits),
  }),
);

export const safetyIncidentActionsRelations = relations(
  safetyIncidentActions,
  ({ one }) => ({
    incident: one(safetyIncidents, {
      fields: [safetyIncidentActions.incidentId],
      references: [safetyIncidents.id],
    }),
    actorUser: one(users, {
      fields: [safetyIncidentActions.actorUserId],
      references: [users.id],
    }),
  }),
);

export const contractorSafetyQuarantinesRelations = relations(
  contractorSafetyQuarantines,
  ({ one }) => ({
    incident: one(safetyIncidents, {
      fields: [contractorSafetyQuarantines.incidentId],
      references: [safetyIncidents.id],
    }),
    contractor: one(contractors, {
      fields: [contractorSafetyQuarantines.contractorId],
      references: [contractors.id],
    }),
    technician: one(technicians, {
      fields: [contractorSafetyQuarantines.technicianId],
      references: [technicians.id],
    }),
    issuedByUser: one(users, {
      fields: [contractorSafetyQuarantines.issuedByUserId],
      references: [users.id],
    }),
  }),
);

export const qualityAuditsRelations = relations(qualityAudits, ({ one }) => ({
  contractor: one(contractors, {
    fields: [qualityAudits.contractorId],
    references: [contractors.id],
  }),
  technician: one(technicians, {
    fields: [qualityAudits.technicianId],
    references: [technicians.id],
  }),
  job: one(jobs, {
    fields: [qualityAudits.jobId],
    references: [jobs.id],
  }),
  incident: one(safetyIncidents, {
    fields: [qualityAudits.incidentId],
    references: [safetyIncidents.id],
  }),
  inspectorUser: one(users, {
    fields: [qualityAudits.inspectorUserId],
    references: [users.id],
  }),
}));

// 14. Electrical Permits, Inspection Evidence & Deficiencies (#59)
export const electricalPermits = pgTable("electrical_permits", {
  id: uuid("id").primaryKey().defaultRandom(),
  permitNumber: text("permit_number").notNull().unique(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id),
  propertyId: uuid("property_id")
    .notNull()
    .references(() => properties.id),
  contractorId: uuid("contractor_id")
    .notNull()
    .references(() => contractors.id),
  technicianId: uuid("technician_id").references(() => technicians.id),
  jurisdiction: text("jurisdiction").notNull().default("ON"),
  permitAuthority: text("permit_authority").notNull().default("ESA"),
  permitType: text("permit_type").notNull().default("ESA_LEC_NOTIFICATION"),
  esaNotificationNumber: text("esa_notification_number").notNull(),
  ecraLicenseNumber: text("ecra_license_number").notNull(),
  designatedMasterElectrician: text("designated_master_electrician").notNull(),
  scopeOfWork: text("scope_of_work").notNull(),
  status: text("status").notNull().default("FILED"),
  utilityDisconnectRequired: boolean("utility_disconnect_required")
    .notNull()
    .default(false),
  utilityProvider: text("utility_provider"),
  utilityMeterNumber: text("utility_meter_number"),
  utilityDisconnectDate: timestamp("utility_disconnect_date", {
    withTimezone: true,
  }),
  utilityReconnectAuthorizationCode: text(
    "utility_reconnect_authorization_code",
  ),
  utilityReconnectDate: timestamp("utility_reconnect_date", {
    withTimezone: true,
  }),
  inspectionStatus: text("inspection_status")
    .notNull()
    .default("NOT_REQUESTED"),
  inspectorName: text("inspector_name"),
  inspectorBadgeNumber: text("inspector_badge_number"),
  inspectedAt: timestamp("inspected_at", { withTimezone: true }),
  certificateOfAcceptanceNumber: text("certificate_of_acceptance_number"),
  certificateOfAcceptanceUrl: text("certificate_of_acceptance_url"),
  certificateOfAcceptanceIssuedAt: timestamp(
    "certificate_of_acceptance_issued_at",
    { withTimezone: true },
  ),
  documentedExceptionReason: text("documented_exception_reason"),
  documentedExceptionApprovedByUserId: uuid(
    "documented_exception_approved_by_user_id",
  ).references(() => users.id),
  documentedExceptionAt: timestamp("documented_exception_at", {
    withTimezone: true,
  }),
  regulatorySignOffStatus: text("regulatory_sign_off_status")
    .notNull()
    .default("PENDING"),
  provenanceAudit: jsonb("provenance_audit").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const permitDeficiencies = pgTable("permit_deficiencies", {
  id: uuid("id").primaryKey().defaultRandom(),
  permitId: uuid("permit_id")
    .notNull()
    .references(() => electricalPermits.id),
  defectCode: text("defect_code").notNull(),
  severity: text("severity").notNull().default("MAJOR"),
  description: text("description").notNull(),
  correctiveActionRequired: text("corrective_action_required").notNull(),
  status: text("status").notNull().default("OPEN"),
  issuedAt: timestamp("issued_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  rectifiedAt: timestamp("rectified_at", { withTimezone: true }),
  rectifiedByUserId: uuid("rectified_by_user_id").references(() => users.id),
  rectificationNotes: text("rectification_notes"),
  rectificationEvidenceUrl: text("rectification_evidence_url"),
  clearedAt: timestamp("cleared_at", { withTimezone: true }),
  clearedByInspector: text("cleared_by_inspector"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const electricalPermitsRelations = relations(
  electricalPermits,
  ({ one, many }) => ({
    job: one(jobs, {
      fields: [electricalPermits.jobId],
      references: [jobs.id],
    }),
    property: one(properties, {
      fields: [electricalPermits.propertyId],
      references: [properties.id],
    }),
    contractor: one(contractors, {
      fields: [electricalPermits.contractorId],
      references: [contractors.id],
    }),
    technician: one(technicians, {
      fields: [electricalPermits.technicianId],
      references: [technicians.id],
    }),
    deficiencies: many(permitDeficiencies),
  }),
);

export const permitDeficienciesRelations = relations(
  permitDeficiencies,
  ({ one }) => ({
    permit: one(electricalPermits, {
      fields: [permitDeficiencies.permitId],
      references: [electricalPermits.id],
    }),
    rectifiedByUser: one(users, {
      fields: [permitDeficiencies.rectifiedByUserId],
      references: [users.id],
    }),
  }),
);

// 15. Versioned Job Risk Scoring & Dispatch Controls (#60)
export const riskPolicies = pgTable("risk_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  version: text("version").notNull().unique(),
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  effectiveDate: timestamp("effective_date", { withTimezone: true })
    .notNull()
    .defaultNow(),
  dimensionsConfig: jsonb("dimensions_config").notNull().default({}),
  hazardFlagRules: jsonb("hazard_flag_rules").notNull().default([]),
  tierThresholds: jsonb("tier_thresholds").notNull().default({}),
  mandatoryControlsConfig: jsonb("mandatory_controls_config")
    .notNull()
    .default([]),
  calibrationNotes: text("calibration_notes"),
  provenanceAudit: jsonb("provenance_audit").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const jobRiskAssessments = pgTable("job_risk_assessments", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").references((): AnyPgColumn => jobs.id),
  serviceRequestId: uuid("service_request_id").references(
    (): AnyPgColumn => serviceRequests.id,
  ),
  policyId: uuid("policy_id")
    .notNull()
    .references(() => riskPolicies.id),
  policyVersion: text("policy_version").notNull(),
  inherentScore: integer("inherent_score").notNull(),
  mitigationsScore: integer("mitigations_score").notNull(),
  residualScore: integer("residual_score").notNull(),
  riskTier: text("risk_tier").notNull(),
  hazardFlags: jsonb("hazard_flags").notNull().default([]),
  mandatoryControls: jsonb("mandatory_controls").notNull().default([]),
  verifiedControls: jsonb("verified_controls").notNull().default([]),
  decisionLog: jsonb("decision_log").notNull().default({}),
  requiresManualApproval: boolean("requires_manual_approval")
    .notNull()
    .default(false),
  manualApprovalStatus: text("manual_approval_status")
    .notNull()
    .default("NOT_REQUIRED"),
  manualApprovedByUserId: uuid("manual_approved_by_user_id").references(
    () => users.id,
  ),
  manualApprovedAt: timestamp("manual_approved_at", { withTimezone: true }),
  manualApprovalNotes: text("manual_approval_notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const riskPoliciesRelations = relations(riskPolicies, ({ many }) => ({
  assessments: many(jobRiskAssessments),
}));

export const jobRiskAssessmentsRelations = relations(
  jobRiskAssessments,
  ({ one }) => ({
    job: one(jobs, {
      fields: [jobRiskAssessments.jobId],
      references: [jobs.id],
    }),
    serviceRequest: one(serviceRequests, {
      fields: [jobRiskAssessments.serviceRequestId],
      references: [serviceRequests.id],
    }),
    policy: one(riskPolicies, {
      fields: [jobRiskAssessments.policyId],
      references: [riskPolicies.id],
    }),
    manualApprovedByUser: one(users, {
      fields: [jobRiskAssessments.manualApprovedByUserId],
      references: [users.id],
    }),
  }),
);

export const legalAgreements = pgTable("legal_agreements", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(),
  version: text("version").notNull(),
  jurisdiction: text("jurisdiction").notNull().default("ON"),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  contentMarkdown: text("content_markdown").notNull(),
  contentChecksum: text("content_checksum").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  effectiveDate: timestamp("effective_date", { withTimezone: true })
    .notNull()
    .defaultNow(),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  legalCounselRef: text("legal_counsel_ref"),
  keyTerms: jsonb("key_terms").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const agreementSignatures = pgTable("agreement_signatures", {
  id: uuid("id").primaryKey().defaultRandom(),
  agreementId: uuid("agreement_id")
    .notNull()
    .references(() => legalAgreements.id),
  agreementType: text("agreement_type").notNull(),
  agreementVersion: text("agreement_version").notNull(),
  jurisdiction: text("jurisdiction").notNull().default("ON"),
  signerUserId: uuid("signer_user_id")
    .notNull()
    .references(() => users.id),
  signerRole: text("signer_role").notNull(),
  entityType: text("entity_type").notNull(),
  contractorId: uuid("contractor_id").references(() => contractors.id),
  signerLegalName: text("signer_legal_name").notNull(),
  signerTitle: text("signer_title"),
  ipAddress: text("ip_address").notNull(),
  userAgent: text("user_agent").notNull(),
  agreementChecksum: text("agreement_checksum").notNull(),
  signedAt: timestamp("signed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const legalAgreementsRelations = relations(
  legalAgreements,
  ({ many }) => ({
    signatures: many(agreementSignatures),
  }),
);

export const agreementSignaturesRelations = relations(
  agreementSignatures,
  ({ one }) => ({
    agreement: one(legalAgreements, {
      fields: [agreementSignatures.agreementId],
      references: [legalAgreements.id],
    }),
    signerUser: one(users, {
      fields: [agreementSignatures.signerUserId],
      references: [users.id],
    }),
    contractor: one(contractors, {
      fields: [agreementSignatures.contractorId],
      references: [contractors.id],
    }),
  }),
);

// 12. Customer Protection Products & Insurance (Ticket #62)
export const customerProtectionProducts = pgTable(
  "customer_protection_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    version: text("version").notNull().default("1.0.0"),
    jurisdiction: text("jurisdiction").notNull().default("ON"),
    underwriterName: text("underwriter_name").notNull(),
    underwriterPolicyRef: text("underwriter_policy_ref").notNull(),
    brokerName: text("broker_name").notNull(),
    brokerLicenseRef: text("broker_license_ref").notNull(),
    coverageLimitCents: bigint("coverage_limit_cents", {
      mode: "number",
    }).notNull(),
    deductibleCents: bigint("deductible_cents", { mode: "number" }).notNull(),
    durationMonths: integer("duration_months").notNull().default(12),
    baseRateBps: integer("base_rate_bps").notNull().default(250),
    minPremiumCents: bigint("min_premium_cents", {
      mode: "number",
    })
      .notNull()
      .default(4900),
    brokerCommissionBps: integer("broker_commission_bps")
      .notNull()
      .default(1500),
    platformFeeBps: integer("platform_fee_bps").notNull().default(1000),
    taxRateBps: integer("tax_rate_bps").notNull().default(800),
    termsMarkdown: text("terms_markdown").notNull(),
    disclaimers: jsonb("disclaimers").notNull().default([]),
    allowedVerticalIds: jsonb("allowed_vertical_ids").notNull().default([]),
    maxJobValueCents: bigint("max_job_value_cents", {
      mode: "number",
    })
      .notNull()
      .default(50000000),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const protectionQuotes = pgTable("protection_quotes", {
  id: uuid("id").primaryKey().defaultRandom(),
  serviceRequestId: uuid("service_request_id")
    .notNull()
    .references(() => serviceRequests.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => customerProtectionProducts.id, { onDelete: "restrict" }),
  jobValueCents: bigint("job_value_cents", { mode: "number" }).notNull(),
  coverageLimitCents: bigint("coverage_limit_cents", {
    mode: "number",
  }).notNull(),
  deductibleCents: bigint("deductible_cents", { mode: "number" }).notNull(),
  grossPremiumCents: bigint("gross_premium_cents", {
    mode: "number",
  }).notNull(),
  brokerCommissionCents: bigint("broker_commission_cents", {
    mode: "number",
  }).notNull(),
  platformFeeCents: bigint("platform_fee_cents", { mode: "number" }).notNull(),
  taxCents: bigint("tax_cents", { mode: "number" }).notNull(),
  totalPayableCents: bigint("total_payable_cents", {
    mode: "number",
  }).notNull(),
  eligible: boolean("eligible").notNull(),
  underwritingDecision: text("underwriting_decision").notNull(),
  declineReasons: jsonb("decline_reasons").notNull().default([]),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("ISSUED"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const protectionPolicies = pgTable("protection_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  certificateNumber: text("certificate_number").notNull().unique(),
  serviceRequestId: uuid("service_request_id")
    .notNull()
    .references(() => serviceRequests.id, { onDelete: "restrict" }),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => customerProtectionProducts.id, { onDelete: "restrict" }),
  quoteId: uuid("quote_id")
    .notNull()
    .references(() => protectionQuotes.id, { onDelete: "restrict" }),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  contractorId: uuid("contractor_id")
    .notNull()
    .references(() => contractors.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("BOUND_ACTIVE"),
  coverageLimitCents: bigint("coverage_limit_cents", {
    mode: "number",
  }).notNull(),
  deductibleCents: bigint("deductible_cents", { mode: "number" }).notNull(),
  grossPremiumCents: bigint("gross_premium_cents", {
    mode: "number",
  }).notNull(),
  taxCents: bigint("tax_cents", { mode: "number" }).notNull(),
  totalPaidCents: bigint("total_paid_cents", { mode: "number" }).notNull(),
  effectiveStartDate: timestamp("effective_start_date", {
    withTimezone: true,
  }).notNull(),
  effectiveEndDate: timestamp("effective_end_date", {
    withTimezone: true,
  }).notNull(),
  cancellationDeadline: timestamp("cancellation_deadline", {
    withTimezone: true,
  }).notNull(),
  policyChecksum: text("policy_checksum").notNull(),
  underwriterPolicyRef: text("underwriter_policy_ref").notNull(),
  brokerLicenseRef: text("broker_license_ref").notNull(),
  bindingEvidenceSnapshot: jsonb("binding_evidence_snapshot")
    .notNull()
    .default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancellationReason: text("cancellation_reason"),
});

export const protectionClaims = pgTable("protection_claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimNumber: text("claim_number").notNull().unique(),
  policyId: uuid("policy_id")
    .notNull()
    .references(() => protectionPolicies.id, { onDelete: "restrict" }),
  serviceRequestId: uuid("service_request_id")
    .notNull()
    .references(() => serviceRequests.id, { onDelete: "restrict" }),
  claimantUserId: uuid("claimant_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  contractorId: uuid("contractor_id")
    .notNull()
    .references(() => contractors.id, { onDelete: "restrict" }),
  incidentDate: timestamp("incident_date", { withTimezone: true }).notNull(),
  incidentDescription: text("incident_description").notNull(),
  claimedAmountCents: bigint("claimed_amount_cents", {
    mode: "number",
  }).notNull(),
  evidenceUrls: jsonb("evidence_urls").notNull().default([]),
  status: text("status").notNull().default("SUBMITTED"),
  adjudicatedAmountCents: bigint("adjudicated_amount_cents", {
    mode: "number",
  }).default(0),
  deductibleAppliedCents: bigint("deductible_applied_cents", {
    mode: "number",
  }).default(0),
  netPayoutCents: bigint("net_payout_cents", { mode: "number" }).default(0),
  adjudicationNotes: text("adjudication_notes"),
  adjudicatedByUserId: uuid("adjudicated_by_user_id").references(
    () => users.id,
  ),
  adjudicatedAt: timestamp("adjudicated_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  declineReasonCode: text("decline_reason_code"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const protectionFinancialLedger = pgTable(
  "protection_financial_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionType: text("transaction_type").notNull(),
    policyId: uuid("policy_id").references(() => protectionPolicies.id, {
      onDelete: "set null",
    }),
    claimId: uuid("claim_id").references(() => protectionClaims.id, {
      onDelete: "set null",
    }),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("CAD"),
    direction: text("direction").notNull(),
    sourceAccount: text("source_account").notNull(),
    destinationAccount: text("destination_account").notNull(),
    reference: text("reference").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const customerProtectionProductsRelations = relations(
  customerProtectionProducts,
  ({ many }) => ({
    quotes: many(protectionQuotes),
    policies: many(protectionPolicies),
  }),
);

export const protectionQuotesRelations = relations(
  protectionQuotes,
  ({ one }) => ({
    product: one(customerProtectionProducts, {
      fields: [protectionQuotes.productId],
      references: [customerProtectionProducts.id],
    }),
    serviceRequest: one(serviceRequests, {
      fields: [protectionQuotes.serviceRequestId],
      references: [serviceRequests.id],
    }),
  }),
);

export const protectionPoliciesRelations = relations(
  protectionPolicies,
  ({ one, many }) => ({
    product: one(customerProtectionProducts, {
      fields: [protectionPolicies.productId],
      references: [customerProtectionProducts.id],
    }),
    quote: one(protectionQuotes, {
      fields: [protectionPolicies.quoteId],
      references: [protectionQuotes.id],
    }),
    serviceRequest: one(serviceRequests, {
      fields: [protectionPolicies.serviceRequestId],
      references: [serviceRequests.id],
    }),
    customer: one(users, {
      fields: [protectionPolicies.customerId],
      references: [users.id],
    }),
    contractor: one(contractors, {
      fields: [protectionPolicies.contractorId],
      references: [contractors.id],
    }),
    claims: many(protectionClaims),
    ledgerEntries: many(protectionFinancialLedger),
  }),
);

export const protectionClaimsRelations = relations(
  protectionClaims,
  ({ one, many }) => ({
    policy: one(protectionPolicies, {
      fields: [protectionClaims.policyId],
      references: [protectionPolicies.id],
    }),
    serviceRequest: one(serviceRequests, {
      fields: [protectionClaims.serviceRequestId],
      references: [serviceRequests.id],
    }),
    claimantUser: one(users, {
      fields: [protectionClaims.claimantUserId],
      references: [users.id],
    }),
    contractor: one(contractors, {
      fields: [protectionClaims.contractorId],
      references: [contractors.id],
    }),
    ledgerEntries: many(protectionFinancialLedger),
  }),
);

export const protectionFinancialLedgerRelations = relations(
  protectionFinancialLedger,
  ({ one }) => ({
    policy: one(protectionPolicies, {
      fields: [protectionFinancialLedger.policyId],
      references: [protectionPolicies.id],
    }),
    claim: one(protectionClaims, {
      fields: [protectionFinancialLedger.claimId],
      references: [protectionClaims.id],
    }),
  }),
);

// 18. Risk-based Job Documentation, Inspections & Incident Escalation (#63)
export const jobDocumentationPackages = pgTable("job_documentation_packages", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id")
    .notNull()
    .unique()
    .references((): AnyPgColumn => jobs.id, { onDelete: "cascade" }),
  serviceRequestId: uuid("service_request_id")
    .notNull()
    .references((): AnyPgColumn => serviceRequests.id, { onDelete: "restrict" }),
  contractorId: uuid("contractor_id")
    .notNull()
    .references(() => contractors.id, { onDelete: "restrict" }),
  technicianId: uuid("technician_id").references(() => technicians.id, {
    onDelete: "set null",
  }),
  propertyId: uuid("property_id")
    .notNull()
    .references(() => properties.id, { onDelete: "restrict" }),
  riskTier: text("risk_tier").notNull().default("LOW"),
  status: text("status").notNull().default("IN_PROGRESS"),
  beforePhotos: jsonb("before_photos").notNull().default([]),
  inProgressPhotos: jsonb("in_progress_photos").notNull().default([]),
  afterPhotos: jsonb("after_photos").notNull().default([]),
  workerIdentityConfirmed: boolean("worker_identity_confirmed")
    .notNull()
    .default(false),
  workerIdentityNotes: text("worker_identity_notes"),
  riskChecklist: jsonb("risk_checklist").notNull().default([]),
  customerSignoff: jsonb("customer_signoff").notNull().default({}),
  permitId: uuid("permit_id").references(() => electricalPermits.id, {
    onDelete: "set null",
  }),
  permitVerified: boolean("permit_verified").notNull().default(false),
  qaAuditId: uuid("qa_audit_id").references(() => qualityAudits.id, {
    onDelete: "set null",
  }),
  qaAuditRequired: boolean("qa_audit_required").notNull().default(false),
  qaAuditStatus: text("qa_audit_status").notNull().default("NOT_REQUIRED"),
  incidentEscalationId: uuid("incident_escalation_id").references(
    () => safetyIncidents.id,
    { onDelete: "set null" },
  ),
  incidentEscalated: boolean("incident_escalated").notNull().default(false),
  deficiencies: jsonb("deficiencies").notNull().default([]),
  exceptionAuditLog: jsonb("exception_audit_log").notNull().default([]),
  submittedByUserId: uuid("submitted_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewNotes: text("review_notes"),
  propertyPassportLinked: boolean("property_passport_linked")
    .notNull()
    .default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const jobDocumentationPackagesRelations = relations(
  jobDocumentationPackages,
  ({ one }) => ({
    job: one(jobs, {
      fields: [jobDocumentationPackages.jobId],
      references: [jobs.id],
    }),
    serviceRequest: one(serviceRequests, {
      fields: [jobDocumentationPackages.serviceRequestId],
      references: [serviceRequests.id],
    }),
    contractor: one(contractors, {
      fields: [jobDocumentationPackages.contractorId],
      references: [contractors.id],
    }),
    technician: one(technicians, {
      fields: [jobDocumentationPackages.technicianId],
      references: [technicians.id],
    }),
    property: one(properties, {
      fields: [jobDocumentationPackages.propertyId],
      references: [properties.id],
    }),
    permit: one(electricalPermits, {
      fields: [jobDocumentationPackages.permitId],
      references: [electricalPermits.id],
    }),
    qaAudit: one(qualityAudits, {
      fields: [jobDocumentationPackages.qaAuditId],
      references: [qualityAudits.id],
    }),
    incidentEscalation: one(safetyIncidents, {
      fields: [jobDocumentationPackages.incidentEscalationId],
      references: [safetyIncidents.id],
    }),
    submittedByUser: one(users, {
      fields: [jobDocumentationPackages.submittedByUserId],
      references: [users.id],
    }),
    reviewedByUser: one(users, {
      fields: [jobDocumentationPackages.reviewedByUserId],
      references: [users.id],
    }),
  }),
);

// 19. Job Completion Reports & Property Service Passport (#50, #51)
export const jobCompletionReports = pgTable("job_completion_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id")
    .notNull()
    .references((): AnyPgColumn => jobs.id, { onDelete: "cascade" }),
  serviceRequestId: uuid("service_request_id")
    .notNull()
    .references((): AnyPgColumn => serviceRequests.id, { onDelete: "restrict" }),
  contractorId: uuid("contractor_id")
    .notNull()
    .references(() => contractors.id, { onDelete: "restrict" }),
  technicianId: uuid("technician_id").references(() => technicians.id, {
    onDelete: "set null",
  }),
  propertyId: uuid("property_id")
    .notNull()
    .references(() => properties.id, { onDelete: "restrict" }),
  reportNumber: text("report_number").notNull().unique(),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("DRAFT"),
  syncStatus: text("sync_status").notNull().default("SYNCED"),
  clientMutationId: text("client_mutation_id"),
  workSummary: text("work_summary").notNull(),
  diagnosis: text("diagnosis").notNull(),
  workStartedAt: timestamp("work_started_at", { withTimezone: true }).notNull(),
  workCompletedAt: timestamp("work_completed_at", { withTimezone: true }).notNull(),
  assetId: uuid("asset_id").references(() => propertySystems.id, {
    onDelete: "set null",
  }),
  partsInstalled: jsonb("parts_installed").notNull().default([]),
  testsPerformed: jsonb("tests_performed").notNull().default([]),
  beforePhotos: jsonb("before_photos").notNull().default([]),
  afterPhotos: jsonb("after_photos").notNull().default([]),
  permitId: uuid("permit_id").references(() => electricalPermits.id, {
    onDelete: "set null",
  }),
  outstandingIssues: jsonb("outstanding_issues").notNull().default([]),
  maintenanceRecommendations: jsonb("maintenance_recommendations").notNull().default([]),
  contractorAttestation: jsonb("contractor_attestation").notNull().default({}),
  customerAcceptance: jsonb("customer_acceptance").notNull().default({}),
  disputeReason: text("dispute_reason"),
  disputedAt: timestamp("disputed_at", { withTimezone: true }),
  disputedByUserId: uuid("disputed_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const propertyAccessGrants = pgTable("property_access_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id")
    .notNull()
    .references(() => properties.id, { onDelete: "cascade" }),
  granteeContractorId: uuid("grantee_contractor_id")
    .notNull()
    .references(() => contractors.id, { onDelete: "restrict" }),
  grantedByUserId: uuid("granted_by_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  scope: text("scope").notNull().default("FULL_HISTORY"),
  serviceVerticalId: uuid("service_vertical_id").references(() => verticals.id, {
    onDelete: "set null",
  }),
  reason: text("reason"),
  status: text("status").notNull().default("ACTIVE"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedByUserId: uuid("revoked_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const propertyOwnershipTransfers = pgTable("property_ownership_transfers", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id")
    .notNull()
    .references(() => properties.id, { onDelete: "cascade" }),
  previousOwnerUserId: uuid("previous_owner_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  newOwnerUserId: uuid("new_owner_user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("PENDING"),
  verificationToken: text("verification_token").notNull().unique(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  transferNotes: text("transfer_notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const jobCompletionReportsRelations = relations(
  jobCompletionReports,
  ({ one }) => ({
    job: one(jobs, {
      fields: [jobCompletionReports.jobId],
      references: [jobs.id],
    }),
    serviceRequest: one(serviceRequests, {
      fields: [jobCompletionReports.serviceRequestId],
      references: [serviceRequests.id],
    }),
    contractor: one(contractors, {
      fields: [jobCompletionReports.contractorId],
      references: [contractors.id],
    }),
    technician: one(technicians, {
      fields: [jobCompletionReports.technicianId],
      references: [technicians.id],
    }),
    property: one(properties, {
      fields: [jobCompletionReports.propertyId],
      references: [properties.id],
    }),
    asset: one(propertySystems, {
      fields: [jobCompletionReports.assetId],
      references: [propertySystems.id],
    }),
    permit: one(electricalPermits, {
      fields: [jobCompletionReports.permitId],
      references: [electricalPermits.id],
    }),
  }),
);

export const propertyAccessGrantsRelations = relations(
  propertyAccessGrants,
  ({ one }) => ({
    property: one(properties, {
      fields: [propertyAccessGrants.propertyId],
      references: [properties.id],
    }),
    granteeContractor: one(contractors, {
      fields: [propertyAccessGrants.granteeContractorId],
      references: [contractors.id],
    }),
    grantedByUser: one(users, {
      fields: [propertyAccessGrants.grantedByUserId],
      references: [users.id],
    }),
  }),
);

export const propertyOwnershipTransfersRelations = relations(
  propertyOwnershipTransfers,
  ({ one }) => ({
    property: one(properties, {
      fields: [propertyOwnershipTransfers.propertyId],
      references: [properties.id],
    }),
    previousOwner: one(users, {
      fields: [propertyOwnershipTransfers.previousOwnerUserId],
      references: [users.id],
    }),
    newOwner: one(users, {
      fields: [propertyOwnershipTransfers.newOwnerUserId],
      references: [users.id],
    }),
  }),
);

// 20. Configurable Workmanship Warranties, Job Snapshots & Claims (#48, #49)
export const warrantyPolicies = pgTable("warranty_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  policyCode: text("policy_code").notNull().unique(),
  version: text("version").notNull().default("1.0.0"),
  verticalId: uuid("vertical_id").references(() => verticals.id, {
    onDelete: "set null",
  }),
  categoryId: uuid("category_id").references(() => serviceCategories.id, {
    onDelete: "set null",
  }),
  jurisdiction: text("jurisdiction").notNull().default("ON"),
  durationMonths: integer("duration_months").notNull().default(12),
  responseSlaHours: integer("response_sla_hours").notNull().default(48),
  emergencySlaHours: integer("emergency_sla_hours").notNull().default(24),
  coveredDefects: jsonb("covered_defects").notNull().default([]),
  exclusions: jsonb("exclusions").notNull().default([]),
  statutoryTerms: text("statutory_terms").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const jobWarrantySnapshots = pgTable("job_warranty_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  certificateNumber: text("certificate_number").notNull().unique(),
  jobId: uuid("job_id")
    .notNull()
    .unique()
    .references((): AnyPgColumn => jobs.id, { onDelete: "cascade" }),
  policyId: uuid("policy_id").references(() => warrantyPolicies.id, {
    onDelete: "set null",
  }),
  propertyId: uuid("property_id")
    .notNull()
    .references(() => properties.id, { onDelete: "restrict" }),
  contractorId: uuid("contractor_id")
    .notNull()
    .references(() => contractors.id, { onDelete: "restrict" }),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  warrantyType: text("warranty_type").notNull().default("STANDARD_WORKMANSHIP"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  durationMonths: integer("duration_months").notNull(),
  coveredDefects: jsonb("covered_defects").notNull().default([]),
  exclusions: jsonb("exclusions").notNull().default([]),
  responseSlaHours: integer("response_sla_hours").notNull().default(48),
  contractorAcknowledged: boolean("contractor_acknowledged")
    .notNull()
    .default(true),
  contractorAcknowledgedAt: timestamp("contractor_acknowledged_at", {
    withTimezone: true,
  })
    .notNull()
    .defaultNow(),
  homeownerCertificateUrl: text("homeowner_certificate_url"),
  termsDigest: text("terms_digest").notNull(),
  status: text("status").notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const warrantyClaims = pgTable("warranty_claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimNumber: text("claim_number").notNull().unique(),
  warrantyId: uuid("warranty_id")
    .notNull()
    .references(() => jobWarrantySnapshots.id, { onDelete: "restrict" }),
  jobId: uuid("job_id")
    .notNull()
    .references((): AnyPgColumn => jobs.id, { onDelete: "restrict" }),
  propertyId: uuid("property_id")
    .notNull()
    .references(() => properties.id, { onDelete: "restrict" }),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  contractorId: uuid("contractor_id")
    .notNull()
    .references(() => contractors.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  evidencePhotos: jsonb("evidence_photos").notNull().default([]),
  urgency: text("urgency").notNull().default("STANDARD"),
  status: text("status").notNull().default("FILED"),
  triageNotes: text("triage_notes"),
  slaDeadline: timestamp("sla_deadline", { withTimezone: true }).notNull(),
  originalContractorAccepted: boolean("original_contractor_accepted"),
  contractorResponseNotes: text("contractor_response_notes"),
  contractorRespondedAt: timestamp("contractor_responded_at", {
    withTimezone: true,
  }),
  callbackJobId: uuid("callback_job_id").references((): AnyPgColumn => jobs.id, {
    onDelete: "set null",
  }),
  remediationCompletedAt: timestamp("remediation_completed_at", {
    withTimezone: true,
  }),
  remediationNotes: text("remediation_notes"),
  disputeReason: text("dispute_reason"),
  disputedAt: timestamp("disputed_at", { withTimezone: true }),
  fallbackContractorId: uuid("fallback_contractor_id").references(
    () => contractors.id,
    { onDelete: "set null" },
  ),
  recoveryAmountCents: bigint("recovery_amount_cents", { mode: "number" })
    .notNull()
    .default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const warrantyRecoveryLedger = pgTable("warranty_recovery_ledger", {
  id: uuid("id").primaryKey().defaultRandom(),
  claimId: uuid("claim_id")
    .notNull()
    .references(() => warrantyClaims.id, { onDelete: "cascade" }),
  contractorId: uuid("contractor_id")
    .notNull()
    .references(() => contractors.id, { onDelete: "restrict" }),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  status: text("status").notNull().default("PENDING"),
  reason: text("reason").notNull(),
  recoveredAt: timestamp("recovered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const warrantyPoliciesRelations = relations(
  warrantyPolicies,
  ({ one }) => ({
    vertical: one(verticals, {
      fields: [warrantyPolicies.verticalId],
      references: [verticals.id],
    }),
    category: one(serviceCategories, {
      fields: [warrantyPolicies.categoryId],
      references: [serviceCategories.id],
    }),
  }),
);

export const jobWarrantySnapshotsRelations = relations(
  jobWarrantySnapshots,
  ({ one, many }) => ({
    job: one(jobs, {
      fields: [jobWarrantySnapshots.jobId],
      references: [jobs.id],
    }),
    policy: one(warrantyPolicies, {
      fields: [jobWarrantySnapshots.policyId],
      references: [warrantyPolicies.id],
    }),
    property: one(properties, {
      fields: [jobWarrantySnapshots.propertyId],
      references: [properties.id],
    }),
    contractor: one(contractors, {
      fields: [jobWarrantySnapshots.contractorId],
      references: [contractors.id],
    }),
    customer: one(users, {
      fields: [jobWarrantySnapshots.customerId],
      references: [users.id],
    }),
    claims: many(warrantyClaims),
  }),
);

export const warrantyClaimsRelations = relations(
  warrantyClaims,
  ({ one, many }) => ({
    warranty: one(jobWarrantySnapshots, {
      fields: [warrantyClaims.warrantyId],
      references: [jobWarrantySnapshots.id],
    }),
    job: one(jobs, {
      fields: [warrantyClaims.jobId],
      references: [jobs.id],
    }),
    property: one(properties, {
      fields: [warrantyClaims.propertyId],
      references: [properties.id],
    }),
    customer: one(users, {
      fields: [warrantyClaims.customerId],
      references: [users.id],
    }),
    contractor: one(contractors, {
      fields: [warrantyClaims.contractorId],
      references: [contractors.id],
    }),
    callbackJob: one(jobs, {
      fields: [warrantyClaims.callbackJobId],
      references: [jobs.id],
    }),
    fallbackContractor: one(contractors, {
      fields: [warrantyClaims.fallbackContractorId],
      references: [contractors.id],
    }),
    recoveryEntries: many(warrantyRecoveryLedger),
  }),
);

export const warrantyRecoveryLedgerRelations = relations(
  warrantyRecoveryLedger,
  ({ one }) => ({
    claim: one(warrantyClaims, {
      fields: [warrantyRecoveryLedger.claimId],
      references: [warrantyClaims.id],
    }),
    contractor: one(contractors, {
      fields: [warrantyRecoveryLedger.contractorId],
      references: [contractors.id],
    }),
  }),
);

// 22. Post-Job Surveys, Fair Reviews & Rewards Ledger (Issue #52)
export const customerFeedbackPreferences = pgTable(
  "customer_feedback_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    feedbackOptIn: boolean("feedback_opt_in").notNull().default(true),
    smsOptIn: boolean("sms_opt_in").notNull().default(false),
    emailOptIn: boolean("email_opt_in").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const postJobSurveys = pgTable("post_job_surveys", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id")
    .notNull()
    .unique()
    .references((): AnyPgColumn => jobs.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  contractorId: uuid("contractor_id")
    .notNull()
    .references(() => contractors.id, { onDelete: "restrict" }),
  surveyToken: text("survey_token").notNull().unique(),
  status: text("status").notNull().default("PENDING"),
  channel: text("channel").notNull().default("EMAIL"),
  overallRating: smallint("overall_rating"),
  qualityRating: smallint("quality_rating"),
  professionalismRating: smallint("professionalism_rating"),
  timelinessRating: smallint("timeliness_rating"),
  communicationRating: smallint("communication_rating"),
  npsScore: smallint("nps_score"),
  feedbackComment: text("feedback_comment"),
  reviewId: uuid("review_id").references((): AnyPgColumn => reviews.id, {
    onDelete: "set null",
  }),
  routedToSupport: boolean("routed_to_support").notNull().default(false),
  supportTicketId: uuid("support_ticket_id").references(
    (): AnyPgColumn => supportTickets.id,
    { onDelete: "set null" },
  ),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const customerRewardCredits = pgTable("customer_reward_credits", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  originJobId: uuid("origin_job_id")
    .notNull()
    .references((): AnyPgColumn => jobs.id, { onDelete: "restrict" }),
  surveyId: uuid("survey_id")
    .notNull()
    .unique()
    .references(() => postJobSurveys.id, { onDelete: "restrict" }),
  rewardType: text("reward_type")
    .notNull()
    .default("POST_JOB_SURVEY_10_PERCENT"),
  amountCents: integer("amount_cents").notNull(),
  balanceCents: integer("balance_cents").notNull(),
  capCents: integer("cap_cents").notNull().default(3000),
  percentageBps: integer("percentage_bps").notNull().default(1000),
  status: text("status").notNull().default("ACTIVE"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
  redeemedJobId: uuid("redeemed_job_id").references((): AnyPgColumn => jobs.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const customerFeedbackPreferencesRelations = relations(
  customerFeedbackPreferences,
  ({ one }) => ({
    customer: one(users, {
      fields: [customerFeedbackPreferences.customerId],
      references: [users.id],
    }),
  }),
);

export const postJobSurveysRelations = relations(
  postJobSurveys,
  ({ one, many }) => ({
    job: one(jobs, {
      fields: [postJobSurveys.jobId],
      references: [jobs.id],
    }),
    customer: one(users, {
      fields: [postJobSurveys.customerId],
      references: [users.id],
    }),
    contractor: one(contractors, {
      fields: [postJobSurveys.contractorId],
      references: [contractors.id],
    }),
    review: one(reviews, {
      fields: [postJobSurveys.reviewId],
      references: [reviews.id],
    }),
    supportTicket: one(supportTickets, {
      fields: [postJobSurveys.supportTicketId],
      references: [supportTickets.id],
    }),
    credit: one(customerRewardCredits, {
      fields: [postJobSurveys.id],
      references: [customerRewardCredits.surveyId],
    }),
  }),
);

export const customerRewardCreditsRelations = relations(
  customerRewardCredits,
  ({ one }) => ({
    customer: one(users, {
      fields: [customerRewardCredits.customerId],
      references: [users.id],
    }),
    originJob: one(jobs, {
      fields: [customerRewardCredits.originJobId],
      references: [jobs.id],
    }),
    survey: one(postJobSurveys, {
      fields: [customerRewardCredits.surveyId],
      references: [postJobSurveys.id],
    }),
    redeemedJob: one(jobs, {
      fields: [customerRewardCredits.redeemedJobId],
      references: [jobs.id],
    }),
  }),
);

export const marketplaceOperationalAlerts = pgTable(
  "marketplace_operational_alerts",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    alertType: varchar("alert_type", { length: 64 }).notNull(),
    severity: varchar("severity", { length: 32 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("ACTIVE"),
    title: text("title").notNull(),
    description: text("description").notNull(),
    verticalSlug: varchar("vertical_slug", { length: 64 }),
    neighbourhood: varchar("neighbourhood", { length: 128 }),
    metricsPayload: jsonb("metrics_payload").default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    acknowledgedByUserId: uuid("acknowledged_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByUserId: uuid("resolved_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    resolutionNotes: text("resolution_notes"),
  },
);

export const marketplaceAnalyticsSnapshots = pgTable(
  "marketplace_analytics_snapshots",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    snapshotTime: timestamp("snapshot_time", { withTimezone: true })
      .notNull()
      .defaultNow(),
    timeWindow: varchar("time_window", { length: 32 }).notNull(),
    verticalSlug: varchar("vertical_slug", { length: 64 }),
    neighbourhood: varchar("neighbourhood", { length: 128 }),
    metrics: jsonb("metrics").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

// 21. Multi-Service Provider Onboarding & Supply CRM (#41, #6)
export const providerOnboardingApplications = pgTable(
  "provider_onboarding_applications",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    prospectEmail: text("prospect_email").notNull(),
    businessName: text("business_name").notNull(),
    businessNumber: text("business_number"),
    businessType: text("business_type").notNull().default("CORPORATION"),
    phone: text("phone").notNull(),
    postalCodes: jsonb("postal_codes").notNull().default([]),
    selectedVerticals: jsonb("selected_verticals").notNull().default([]),
    serviceRatesProposal: jsonb("service_rates_proposal").notNull().default([]),
    weeklyCapacity: integer("weekly_capacity").notNull().default(10),
    technicianCount: integer("technician_count").notNull().default(1),
    status: varchar("status", { length: 32 }).notNull().default("PROSPECT"),
    saveToken: varchar("save_token", { length: 64 }).notNull().unique(),
    draftStep: integer("draft_step").notNull().default(1),
    draftPayload: jsonb("draft_payload").notNull().default({}),
    consentAccepted: boolean("consent_accepted").notNull().default(false),
    consentAcceptedAt: timestamp("consent_accepted_at", { withTimezone: true }),
    applicantUserId: uuid("applicant_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    convertedContractorId: uuid("converted_contractor_id").references(
      () => contractors.id,
      { onDelete: "set null" },
    ),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewNotes: text("review_notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const providerServiceGeographyApprovals = pgTable(
  "provider_service_geography_approvals",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    applicationId: varchar("application_id", { length: 64 })
      .notNull()
      .references(() => providerOnboardingApplications.id, {
        onDelete: "cascade",
      }),
    contractorId: uuid("contractor_id").references(() => contractors.id, {
      onDelete: "cascade",
    }),
    verticalSlug: varchar("vertical_slug", { length: 64 }).notNull(),
    territoryCode: varchar("territory_code", { length: 32 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("PENDING"),
    decisionReason: text("decision_reason"),
    reviewedByUserId: uuid("reviewed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const providerTechnicianRosters = pgTable(
  "provider_technician_roster",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    applicationId: varchar("application_id", { length: 64 })
      .notNull()
      .references(() => providerOnboardingApplications.id, {
        onDelete: "cascade",
      }),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone").notNull(),
    tradeLicenseCode: text("trade_license_code").notNull(),
    licenseNumber: text("license_number").notNull(),
    licenseExpiry: date("license_expiry").notNull(),
    backgroundCheckStatus: varchar("background_check_status", { length: 32 })
      .notNull()
      .default("PENDING"),
    isEmergencyAvailable: boolean("is_emergency_available")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const providerOnboardingApplicationsRelations = relations(
  providerOnboardingApplications,
  ({ many, one }) => ({
    approvals: many(providerServiceGeographyApprovals),
    technicians: many(providerTechnicianRosters),
    applicantUser: one(users, {
      fields: [providerOnboardingApplications.applicantUserId],
      references: [users.id],
    }),
    convertedContractor: one(contractors, {
      fields: [providerOnboardingApplications.convertedContractorId],
      references: [contractors.id],
    }),
  }),
);

export const providerServiceGeographyApprovalsRelations = relations(
  providerServiceGeographyApprovals,
  ({ one }) => ({
    application: one(providerOnboardingApplications, {
      fields: [providerServiceGeographyApprovals.applicationId],
      references: [providerOnboardingApplications.id],
    }),
    contractor: one(contractors, {
      fields: [providerServiceGeographyApprovals.contractorId],
      references: [contractors.id],
    }),
  }),
);

export const providerTechnicianRostersRelations = relations(
  providerTechnicianRosters,
  ({ one }) => ({
    application: one(providerOnboardingApplications, {
      fields: [providerTechnicianRosters.applicationId],
      references: [providerOnboardingApplications.id],
    }),
  }),
);

// ---------------------------------------------------------------------------
// 27. Technician Scheduling, Dispatch Overlap Protection & Offers
// ---------------------------------------------------------------------------

export const technicianSchedules = pgTable(
  "technician_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    technicianId: uuid("technician_id")
      .notNull()
      .references(() => technicians.id, { onDelete: "cascade" }),
    contractorId: uuid("contractor_id")
      .notNull()
      .references(() => contractors.id, { onDelete: "cascade" }),
    dayOfWeek: integer("day_of_week").notNull(),
    startTime: varchar("start_time", { length: 5 }).notNull(),
    endTime: varchar("end_time", { length: 5 }).notNull(),
    timezone: varchar("timezone", { length: 64 })
      .notNull()
      .default("America/Toronto"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_tech_schedule").on(
      table.technicianId,
      table.dayOfWeek,
      table.startTime,
    ),
  ],
);

export const technicianScheduleExceptions = pgTable(
  "technician_schedule_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    technicianId: uuid("technician_id")
      .notNull()
      .references(() => technicians.id, { onDelete: "cascade" }),
    exceptionType: varchar("exception_type", { length: 32 })
      .notNull()
      .default("TIME_OFF"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    startTime: varchar("start_time", { length: 5 }),
    endTime: varchar("end_time", { length: 5 }),
    allDay: boolean("all_day").notNull().default(true),
    reason: text("reason"),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const technicianServiceRegions = pgTable(
  "technician_service_regions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    technicianId: uuid("technician_id")
      .notNull()
      .references(() => technicians.id, { onDelete: "cascade" }),
    contractorId: uuid("contractor_id")
      .notNull()
      .references(() => contractors.id, { onDelete: "cascade" }),
    postalFsa: varchar("postal_fsa", { length: 8 }).notNull(),
    maxTravelRadiusKm: integer("max_travel_radius_km").notNull().default(25),
    travelBufferMinutes: integer("travel_buffer_minutes").notNull().default(30),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_tech_region").on(table.technicianId, table.postalFsa),
  ],
);

export const dispatchSlotHolds = pgTable(
  "dispatch_slot_holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceRequestId: uuid("service_request_id")
      .references(() => serviceRequests.id, { onDelete: "cascade" }),
    technicianId: uuid("technician_id")
      .notNull()
      .references(() => technicians.id, { onDelete: "cascade" }),
    contractorId: uuid("contractor_id")
      .notNull()
      .references(() => contractors.id, { onDelete: "cascade" }),
    holdToken: varchar("hold_token", { length: 64 }).unique(),
    postalFsa: varchar("postal_fsa", { length: 8 }),
    verticalId: uuid("vertical_id").references(() => verticals.id, { onDelete: "cascade" }),
    slotStartsAt: timestamp("slot_starts_at", { withTimezone: true }).notNull(),
    slotEndsAt: timestamp("slot_ends_at", { withTimezone: true }).notNull(),
    travelBufferMinutes: integer("travel_buffer_minutes").notNull().default(30),
    bufferedStartsAt: timestamp("buffered_starts_at", { withTimezone: true }).notNull(),
    bufferedEndsAt: timestamp("buffered_ends_at", { withTimezone: true }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("HELD"),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }).notNull(),
    heldByUserId: uuid("held_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const dispatchOffers = pgTable(
  "dispatch_offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceRequestId: uuid("service_request_id")
      .notNull()
      .references(() => serviceRequests.id, { onDelete: "cascade" }),
    technicianId: uuid("technician_id")
      .notNull()
      .references(() => technicians.id, { onDelete: "cascade" }),
    contractorId: uuid("contractor_id")
      .notNull()
      .references(() => contractors.id, { onDelete: "cascade" }),
    slotHoldId: uuid("slot_hold_id").references(() => dispatchSlotHolds.id, {
      onDelete: "set null",
    }),
    candidateRank: integer("candidate_rank").notNull().default(1),
    candidateScore: integer("candidate_score").notNull().default(100),
    status: varchar("status", { length: 32 }).notNull().default("OFFERED"),
    offeredAt: timestamp("offered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    declineReason: varchar("decline_reason", { length: 64 }),
    declineNotes: text("decline_notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const dispatchFallbackQueue = pgTable(
  "dispatch_fallback_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceRequestId: uuid("service_request_id")
      .notNull()
      .unique()
      .references(() => serviceRequests.id, { onDelete: "cascade" }),
    failedOfferCount: integer("failed_offer_count").notNull().default(0),
    reason: varchar("reason", { length: 64 })
      .notNull()
      .default("ALL_OFFERS_EXHAUSTED"),
    status: varchar("status", { length: 32 })
      .notNull()
      .default("PENDING_TRIAGE"),
    assignedTechnicianId: uuid("assigned_technician_id").references(
      () => technicians.id,
    ),
    triagedByUserId: uuid("triaged_by_user_id").references(() => users.id),
    triagedAt: timestamp("triaged_at", { withTimezone: true }),
    resolutionNotes: text("resolution_notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

// 22. Technician Service Recommendations & Homeowner Response Lifecycle
export const serviceRecommendations = pgTable("service_recommendations", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  serviceRequestId: uuid("service_request_id")
    .notNull()
    .references(() => serviceRequests.id, { onDelete: "cascade" }),
  propertyId: uuid("property_id")
    .notNull()
    .references(() => properties.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  contractorId: uuid("contractor_id")
    .notNull()
    .references(() => contractors.id, { onDelete: "cascade" }),
  technicianId: uuid("technician_id")
    .notNull()
    .references(() => technicians.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description").notNull(),
  verticalId: uuid("vertical_id").references(() => verticals.id, {
    onDelete: "set null",
  }),
  categoryId: uuid("category_id").references(() => serviceCategories.id, {
    onDelete: "set null",
  }),
  urgency: recommendationUrgencyEnum("urgency")
    .notNull()
    .default("RECOMMENDED_MAINTENANCE"),
  status: recommendationStatusEnum("status").notNull().default("PROPOSED"),
  estimatedCostCents: bigint("estimated_cost_cents", { mode: "number" })
    .notNull()
    .default(0),
  currency: char("currency", { length: 3 }).notNull().default("CAD"),
  evidencePhotos: jsonb("evidence_photos").notNull().default([]),
  homeownerResponseNotes: text("homeowner_response_notes"),
  declineReason: recommendationDeclineReasonEnum("decline_reason"),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  convertedServiceRequestId: uuid("converted_service_request_id").references(
    () => serviceRequests.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const serviceRecommendationResponses = pgTable(
  "service_recommendation_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recommendationId: uuid("recommendation_id")
      .notNull()
      .references(() => serviceRecommendations.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 32 }).notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    actorRole: varchar("actor_role", { length: 32 }).notNull(),
    notes: text("notes"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const serviceRecommendationsRelations = relations(
  serviceRecommendations,
  ({ one, many }) => ({
    job: one(jobs, {
      fields: [serviceRecommendations.jobId],
      references: [jobs.id],
    }),
    serviceRequest: one(serviceRequests, {
      fields: [serviceRecommendations.serviceRequestId],
      references: [serviceRequests.id],
    }),
    property: one(properties, {
      fields: [serviceRecommendations.propertyId],
      references: [properties.id],
    }),
    customer: one(users, {
      fields: [serviceRecommendations.customerId],
      references: [users.id],
    }),
    contractor: one(contractors, {
      fields: [serviceRecommendations.contractorId],
      references: [contractors.id],
    }),
    technician: one(technicians, {
      fields: [serviceRecommendations.technicianId],
      references: [technicians.id],
    }),
    vertical: one(verticals, {
      fields: [serviceRecommendations.verticalId],
      references: [verticals.id],
    }),
    category: one(serviceCategories, {
      fields: [serviceRecommendations.categoryId],
      references: [serviceCategories.id],
    }),
    responses: many(serviceRecommendationResponses),
  }),
);

export const serviceRecommendationResponsesRelations = relations(
  serviceRecommendationResponses,
  ({ one }) => ({
    recommendation: one(serviceRecommendations, {
      fields: [serviceRecommendationResponses.recommendationId],
      references: [serviceRecommendations.id],
    }),
    actor: one(users, {
      fields: [serviceRecommendationResponses.actorId],
      references: [users.id],
    }),
  }),
);

export const stripeConnectAccountsRelations = relations(
  stripeConnectAccounts,
  ({ one }) => ({
    contractor: one(contractors, {
      fields: [stripeConnectAccounts.contractorId],
      references: [contractors.id],
    }),
  }),
);

export const customerPaymentMethodsRelations = relations(
  customerPaymentMethods,
  ({ one }) => ({
    customer: one(users, {
      fields: [customerPaymentMethods.customerId],
      references: [users.id],
    }),
  }),
);

export const paymentIntentsRelations = relations(paymentIntents, ({ one }) => ({
  milestone: one(paymentMilestones, {
    fields: [paymentIntents.milestoneId],
    references: [paymentMilestones.id],
  }),
  customer: one(users, {
    fields: [paymentIntents.customerId],
    references: [users.id],
  }),
  contractor: one(contractors, {
    fields: [paymentIntents.contractorId],
    references: [contractors.id],
  }),
}));

export const marketplaceFinancialLedgerRelations = relations(
  marketplaceFinancialLedger,
  ({ one }) => ({
    contractor: one(contractors, {
      fields: [marketplaceFinancialLedger.contractorId],
      references: [contractors.id],
    }),
    customer: one(users, {
      fields: [marketplaceFinancialLedger.customerId],
      references: [users.id],
    }),
    job: one(jobs, {
      fields: [marketplaceFinancialLedger.jobId],
      references: [jobs.id],
    }),
    milestone: one(paymentMilestones, {
      fields: [marketplaceFinancialLedger.milestoneId],
      references: [paymentMilestones.id],
    }),
    transaction: one(paymentTransactions, {
      fields: [marketplaceFinancialLedger.transactionId],
      references: [paymentTransactions.id],
    }),
    refund: one(refunds, {
      fields: [marketplaceFinancialLedger.refundId],
      references: [refunds.id],
    }),
  }),
);

export const payoutHoldsRelations = relations(payoutHolds, ({ one }) => ({
  contractor: one(contractors, {
    fields: [payoutHolds.contractorId],
    references: [contractors.id],
  }),
  milestone: one(paymentMilestones, {
    fields: [payoutHolds.milestoneId],
    references: [paymentMilestones.id],
  }),
  placedBy: one(users, {
    fields: [payoutHolds.placedByUserId],
    references: [users.id],
  }),
  releasedBy: one(users, {
    fields: [payoutHolds.releasedByUserId],
    references: [users.id],
  }),
}));

export const contractorPayoutBalancesRelations = relations(
  contractorPayoutBalances,
  ({ one }) => ({
    contractor: one(contractors, {
      fields: [contractorPayoutBalances.contractorId],
      references: [contractors.id],
    }),
  }),
);

export const financialReconciliationReportsRelations = relations(
  financialReconciliationReports,
  ({ one }) => ({
    generatedByUser: one(users, {
      fields: [financialReconciliationReports.generatedBy],
      references: [users.id],
    }),
  }),
);

// 26. Transactional Outbox & Reliable Notifications (SH-09)
export const notificationTemplates = pgTable(
  "notification_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateSlug: text("template_slug").notNull(),
    version: integer("version").notNull().default(1),
    channel: notificationChannelEnum("channel").notNull(),
    subjectTemplate: text("subject_template"),
    bodyTemplate: text("body_template").notNull(),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    uqTemplateVersion: unique("uq_notification_template_version").on(
      table.templateSlug,
      table.version,
      table.channel,
    ),
  }),
);

export const userNotificationPreferences = pgTable(
  "user_notification_preferences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: notificationChannelEnum("channel").notNull(),
    category: notificationPreferenceCategoryEnum("category").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
    optInSource: text("opt_in_source").notNull().default("ONBOARDING_CONSENT"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    uqUserChannelCategory: unique("uq_user_channel_category").on(
      table.userId,
      table.channel,
      table.category,
    ),
  }),
);

export const transactionalOutbox = pgTable(
  "transactional_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    channel: notificationChannelEnum("channel").notNull(),
    destination: text("destination").notNull(),
    templateSlug: text("template_slug").notNull(),
    templateVersion: integer("template_version").notNull().default(1),
    payload: jsonb("payload").notNull().default({}),
    status: outboxStatusEnum("status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const notificationDeliveryLogs = pgTable(
  "notification_delivery_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    outboxId: uuid("outbox_id")
      .notNull()
      .references(() => transactionalOutbox.id, { onDelete: "cascade" }),
    channel: notificationChannelEnum("channel").notNull(),
    recipient: text("recipient").notNull(),
    providerName: text("provider_name").notNull(),
    providerMessageId: text("provider_message_id"),
    attemptNumber: integer("attempt_number").notNull(),
    durationMs: integer("duration_ms").notNull(),
    status: text("status").notNull(),
    responsePayload: jsonb("response_payload").notNull().default({}),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
);

export const notificationTemplatesRelations = relations(
  notificationTemplates,
  () => ({}),
);

export const userNotificationPreferencesRelations = relations(
  userNotificationPreferences,
  ({ one }) => ({
    user: one(users, {
      fields: [userNotificationPreferences.userId],
      references: [users.id],
    }),
  }),
);

export const transactionalOutboxRelations = relations(
  transactionalOutbox,
  ({ one, many }) => ({
    recipientUser: one(users, {
      fields: [transactionalOutbox.recipientUserId],
      references: [users.id],
    }),
    deliveryLogs: many(notificationDeliveryLogs),
  }),
);

export const notificationDeliveryLogsRelations = relations(
  notificationDeliveryLogs,
  ({ one }) => ({
    outbox: one(transactionalOutbox, {
      fields: [notificationDeliveryLogs.outboxId],
      references: [transactionalOutbox.id],
    }),
  }),
);

// 25. Dispatch Exceptions, Cancellations, SLA Tracking, and Recovery (SH-10)
export const dispatchExceptions = pgTable("dispatch_exceptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  serviceRequestId: uuid("service_request_id")
    .notNull()
    .references(() => serviceRequests.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
  contractorId: uuid("contractor_id").references(() => contractors.id, { onDelete: "set null" }),
  technicianId: uuid("technician_id").references(() => technicians.id, { onDelete: "set null" }),
  exceptionType: varchar("exception_type", { length: 64 }).notNull(),
  reason: varchar("reason", { length: 255 }).notNull(),
  notes: text("notes"),
  severity: varchar("severity", { length: 32 }).notNull().default("MEDIUM"),
  status: varchar("status", { length: 32 }).notNull().default("OPEN"),
  slaDeadlineAt: timestamp("sla_deadline_at", { withTimezone: true }).notNull(),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id),
  resolutionType: varchar("resolution_type", { length: 64 }),
  compensationAmountCents: integer("compensation_amount_cents").notNull().default(0),
  feeAmountCents: integer("fee_amount_cents").notNull().default(0),
  customerCreditCents: integer("customer_credit_cents").notNull().default(0),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const jobCancellations = pgTable("job_cancellations", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
  serviceRequestId: uuid("service_request_id")
    .notNull()
    .references(() => serviceRequests.id, { onDelete: "cascade" }),
  cancelledByRole: varchar("cancelled_by_role", { length: 32 }).notNull(),
  cancelledByUserId: uuid("cancelled_by_user_id").notNull().references(() => users.id),
  cancellationReason: varchar("cancellation_reason", { length: 64 }).notNull(),
  cancellationNotes: text("cancellation_notes"),
  policyApplied: varchar("policy_applied", { length: 64 }).notNull(),
  originalAmountPaidCents: integer("original_amount_paid_cents").notNull().default(0),
  cancellationFeeCents: integer("cancellation_fee_cents").notNull().default(0),
  refundAmountCents: integer("refund_amount_cents").notNull().default(0),
  contractorPayoutCents: integer("contractor_payout_cents").notNull().default(0),
  customerCreditCents: integer("customer_credit_cents").notNull().default(0),
  contractorPenaltyCents: integer("contractor_penalty_cents").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const customerServiceCredits = pgTable("customer_service_credits", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict" }),
  amountCents: integer("amount_cents").notNull(),
  balanceCents: integer("balance_cents").notNull(),
  reason: varchar("reason", { length: 64 }).notNull(),
  referenceType: varchar("reference_type", { length: 32 }),
  referenceId: uuid("reference_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  status: varchar("status", { length: 32 }).notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const contractorDispatchPenalties = pgTable("contractor_dispatch_penalties", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractorId: uuid("contractor_id")
    .notNull()
    .references(() => contractors.id, { onDelete: "cascade" }),
  technicianId: uuid("technician_id").references(() => technicians.id, { onDelete: "set null" }),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
  strikeType: varchar("strike_type", { length: 64 }).notNull(),
  penaltyAmountCents: integer("penalty_amount_cents").notNull().default(0),
  strikePoints: integer("strike_points").notNull().default(1),
  notes: text("notes"),
  status: varchar("status", { length: 32 }).notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const dispatchExceptionsRelations = relations(dispatchExceptions, ({ one }) => ({
  serviceRequest: one(serviceRequests, {
    fields: [dispatchExceptions.serviceRequestId],
    references: [serviceRequests.id],
  }),
  job: one(jobs, {
    fields: [dispatchExceptions.jobId],
    references: [jobs.id],
  }),
  contractor: one(contractors, {
    fields: [dispatchExceptions.contractorId],
    references: [contractors.id],
  }),
  technician: one(technicians, {
    fields: [dispatchExceptions.technicianId],
    references: [technicians.id],
  }),
  resolvedByUser: one(users, {
    fields: [dispatchExceptions.resolvedByUserId],
    references: [users.id],
  }),
}));

export const jobCancellationsRelations = relations(jobCancellations, ({ one }) => ({
  serviceRequest: one(serviceRequests, {
    fields: [jobCancellations.serviceRequestId],
    references: [serviceRequests.id],
  }),
  job: one(jobs, {
    fields: [jobCancellations.jobId],
    references: [jobs.id],
  }),
  cancelledByUser: one(users, {
    fields: [jobCancellations.cancelledByUserId],
    references: [users.id],
  }),
}));

export const customerServiceCreditsRelations = relations(customerServiceCredits, ({ one }) => ({
  customer: one(users, {
    fields: [customerServiceCredits.customerId],
    references: [users.id],
  }),
}));

export const contractorDispatchPenaltiesRelations = relations(
  contractorDispatchPenalties,
  ({ one }) => ({
    contractor: one(contractors, {
      fields: [contractorDispatchPenalties.contractorId],
      references: [contractors.id],
    }),
    technician: one(technicians, {
      fields: [contractorDispatchPenalties.technicianId],
      references: [technicians.id],
    }),
    job: one(jobs, {
      fields: [contractorDispatchPenalties.jobId],
      references: [jobs.id],
    }),
  }),
);

// 29. Customer Booking Drafts (#12, SH-11)
export const bookingDrafts = pgTable(
  "booking_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    step: integer("step").notNull().default(0),
    draftPayload: jsonb("draft_payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_booking_drafts_customer_id").on(table.customerId),
    index("idx_booking_drafts_customer").on(table.customerId),
  ],
);

export const bookingDraftsRelations = relations(bookingDrafts, ({ one }) => ({
  customer: one(users, {
    fields: [bookingDrafts.customerId],
    references: [users.id],
  }),
}));

// 30. Job Messaging & Masked Communications (#15, SH-14)
export const jobConversations = pgTable(
  "job_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 32 }).notNull().default("ACTIVE"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (table) => [
    unique("uq_job_conversations_job_id").on(table.jobId),
    index("idx_job_conversations_job").on(table.jobId),
  ],
);

export const jobConversationsRelations = relations(
  jobConversations,
  ({ one, many }) => ({
    job: one(jobs, {
      fields: [jobConversations.jobId],
      references: [jobs.id],
    }),
    messages: many(jobMessages),
    maskedSession: one(maskedCommunicationSessions),
  }),
);

export const jobMessages = pgTable(
  "job_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => jobConversations.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    senderUserId: uuid("sender_user_id")
      .notNull()
      .references(() => users.id),
    senderRole: varchar("sender_role", { length: 32 }).notNull(),
    content: text("content").notNull(),
    attachmentKeys: jsonb("attachment_keys").notNull().default([]),
    status: varchar("status", { length: 32 }).notNull().default("SENT"),
    moderationStatus: varchar("moderation_status", { length: 32 })
      .notNull()
      .default("CLEAN"),
    moderationReason: text("moderation_reason"),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    readBy: uuid("read_by").references(() => users.id),
  },
  (table) => [
    index("idx_job_messages_job_created").on(table.jobId, table.createdAt),
    index("idx_job_messages_conversation").on(
      table.conversationId,
      table.createdAt,
    ),
    index("idx_job_messages_sender").on(table.senderUserId),
  ],
);

export const jobMessagesRelations = relations(jobMessages, ({ one }) => ({
  conversation: one(jobConversations, {
    fields: [jobMessages.conversationId],
    references: [jobConversations.id],
  }),
  job: one(jobs, {
    fields: [jobMessages.jobId],
    references: [jobs.id],
  }),
  senderUser: one(users, {
    fields: [jobMessages.senderUserId],
    references: [users.id],
  }),
  readByUser: one(users, {
    fields: [jobMessages.readBy],
    references: [users.id],
  }),
}));

export const maskedCommunicationSessions = pgTable(
  "masked_communication_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    virtualProxyNumber: varchar("virtual_proxy_number", { length: 32 })
      .notNull()
      .default("+16475550199"),
    sessionExtension: varchar("session_extension", { length: 16 }).notNull(),
    sessionPin: varchar("session_pin", { length: 16 }).notNull(),
    customerUserId: uuid("customer_user_id")
      .notNull()
      .references(() => users.id),
    technicianUserId: uuid("technician_user_id")
      .notNull()
      .references(() => users.id),
    isActive: boolean("is_active").notNull().default(true),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    callCount: integer("call_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("uq_masked_communication_sessions_job_id").on(table.jobId),
    index("idx_masked_comm_job_active").on(table.jobId, table.isActive),
    index("idx_masked_comm_pin").on(
      table.virtualProxyNumber,
      table.sessionExtension,
      table.sessionPin,
    ),
  ],
);

export const maskedCommunicationSessionsRelations = relations(
  maskedCommunicationSessions,
  ({ one }) => ({
    job: one(jobs, {
      fields: [maskedCommunicationSessions.jobId],
      references: [jobs.id],
    }),
    customerUser: one(users, {
      fields: [maskedCommunicationSessions.customerUserId],
      references: [users.id],
    }),
    technicianUser: one(users, {
      fields: [maskedCommunicationSessions.technicianUserId],
      references: [users.id],
    }),
  }),
);






