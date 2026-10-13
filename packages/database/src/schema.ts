import { relations, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  date,
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

// 2. Core Identity & RBAC
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
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
export const properties = pgTable("properties", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => users.id),
  label: text("label").notNull(),
  addressLine1: text("address_line1").notNull(),
  city: text("city").notNull(),
  region: text("region").notNull(),
  postalCode: text("postal_code").notNull(),
  latitude: numeric("latitude", { precision: 9, scale: 6 }),
  longitude: numeric("longitude", { precision: 9, scale: 6 }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

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
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// 7. Quotes & Payment Schedules
export const quotes = pgTable("quotes", {
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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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

export const changeOrders = pgTable("change_orders", {
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
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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


