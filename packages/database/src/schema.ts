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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
    basePriceCents: bigint("base_price_cents", { mode: "number" }).notNull().default(0),
    defaultDurationMinutes: integer("default_duration_minutes").notNull().default(120),
    requiresPermit: boolean("requires_permit").notNull().default(false),
    permitType: text("permit_type"),
    requiredEvidence: jsonb("required_evidence").notNull().default(["before_photo", "after_photo"]),
    defaultWarrantyMonths: integer("default_warranty_months").notNull().default(12),
    geographicRestrictions: jsonb("geographic_restrictions").notNull().default(["ON"]),
    tags: jsonb("tags").notNull().default([]),
    equipmentFields: jsonb("equipment_fields").notNull().default([]),
    launchReady: boolean("launch_ready").notNull().default(false),
    displayOrder: integer("display_order").notNull().default(100),
    active: boolean("active").notNull().default(true),
  },
  (table) => [
    unique("issue_types_category_id_slug_key").on(
      table.categoryId,
      table.slug,
    ),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const credentials = pgTable("credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractorId: uuid("contractor_id").references(() => contractors.id),
  technicianId: uuid("technician_id").references(() => technicians.id),
  code: text("code").notNull(),
  geography: text("geography").notNull().default("*"),
  status: verificationStatusEnum("status").notNull().default("PENDING"),
  verificationSource: text("verification_source").notNull().default("SELF_UPLOAD"),
  verifiedByUserId: uuid("verified_by_user_id").references(() => users.id),
  regulatorReference: text("regulator_reference"),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  limitations: text("limitations"),
  auditorNotes: text("auditor_notes"),
  expiryDate: date("expiry_date"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  documentKey: text("document_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
  assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// 7. Quotes & Payment Schedules
export const quotes = pgTable("quotes", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id),
  version: integer("version").notNull(),
  status: quoteStatusEnum("status").notNull().default("DRAFT"),
  contractorSubtotalCents: bigint("contractor_subtotal_cents", { mode: "number" }).notNull().default(0),
  platformFeeCents: bigint("platform_fee_cents", { mode: "number" }).notNull().default(0),
  discountCents: bigint("discount_cents", { mode: "number" }).notNull().default(0),
  taxCents: bigint("tax_cents", { mode: "number" }).notNull().default(0),
  customerTotalCents: bigint("customer_total_cents", { mode: "number" }).notNull().default(0),
  currency: char("currency", { length: 3 }).notNull().default("CAD"),
  notes: text("notes"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  acceptedBy: uuid("accepted_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

export const processedWebhooks = pgTable(
  "processed_webhooks",
  {
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const riskEvents = pgTable("risk_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(),
  customerId: uuid("customer_id").references(() => users.id),
  contractorId: uuid("contractor_id").references(() => contractors.id),
  jobId: uuid("job_id").references(() => jobs.id),
  score: integer("score").notNull().default(0),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const warranties = pgTable("warranties", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertySystemId: uuid("property_system_id").references(() => propertySystems.id),
  serviceRecordId: uuid("service_record_id").references(() => serviceRecords.id),
  providerName: text("provider_name").notNull(),
  warrantyType: text("warranty_type").notNull(),
  startsOn: date("starts_on"),
  expiresOn: date("expires_on"),
  termsUrl: text("terms_url"),
  status: text("status").notNull().default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  contractorSubtotalCents: bigint("contractor_subtotal_cents", { mode: "number" }).notNull().default(0),
  platformFeeCents: bigint("platform_fee_cents", { mode: "number" }).notNull().default(0),
  taxCents: bigint("tax_cents", { mode: "number" }).notNull().default(0),
  customerTotalCents: bigint("customer_total_cents", { mode: "number" }).notNull().default(0),
  currency: char("currency", { length: 3 }).notNull().default("CAD"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  acceptedBy: uuid("accepted_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  pdfKey: text("pdf_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const supportTickets = pgTable("support_tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: uuid("customer_id").references(() => users.id),
  contractorId: uuid("contractor_id").references(() => contractors.id),
  jobId: uuid("job_id").references(() => jobs.id),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  status: supportStatusEnum("status").notNull().default("OPEN"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const domainEvents = pgTable("domain_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  aggregateType: text("aggregate_type").notNull(),
  aggregateId: uuid("aggregate_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
});

export const customerContractorRelationships = pgTable("customer_contractor_relationships", {
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const feeRules = pgTable("fee_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  verticalId: uuid("vertical_id").references(() => verticals.id),
  contractorId: uuid("contractor_id").references(() => contractors.id),
  relationshipStage: text("relationship_stage").notNull(),
  takeRateBps: integer("take_rate_bps").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// 10. Compliance Standards & Evaluations
export const credentialGroups = pgTable("credential_groups", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  displayOrder: integer("display_order").notNull(),
  icon: text("icon").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
  evaluatedAt: timestamp("evaluated_at", { withTimezone: true }).notNull().defaultNow(),
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
    contractorMandatoryCodes: jsonb("contractor_mandatory_codes").notNull().default([]),
    technicianMandatoryCodes: jsonb("technician_mandatory_codes").notNull().default([]),
    apprenticeEligible: boolean("apprentice_eligible").notNull().default(false),
    supervisorRatio: text("supervisor_ratio").default("1:1"),
    permitRequired: boolean("permit_required").notNull().default(false),
    inspectionAuthority: text("inspection_authority"),
    legalAuthorityDisclaimer: text("legal_authority_disclaimer").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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

// 12. Relational mappings
export const verticalsRelations = relations(verticals, ({ many }) => ({
  categories: many(serviceCategories),
}));

export const serviceCategoriesRelations = relations(serviceCategories, ({ one, many }) => ({
  vertical: one(verticals, {
    fields: [serviceCategories.verticalId],
    references: [verticals.id],
  }),
  issueTypes: many(issueTypes),
}));

export const issueTypesRelations = relations(issueTypes, ({ one }) => ({
  category: one(serviceCategories, {
    fields: [issueTypes.categoryId],
    references: [serviceCategories.id],
  }),
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
}));

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

export const serviceRequestsRelations = relations(serviceRequests, ({ one }) => ({
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
}));

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

export const paymentSchedulesRelations = relations(paymentSchedules, ({ one, many }) => ({
  quote: one(quotes, {
    fields: [paymentSchedules.quoteId],
    references: [quotes.id],
  }),
  milestones: many(paymentMilestones),
}));

export const paymentMilestonesRelations = relations(paymentMilestones, ({ one }) => ({
  schedule: one(paymentSchedules, {
    fields: [paymentMilestones.scheduleId],
    references: [paymentSchedules.id],
  }),
}));
