import dotenv from "dotenv";
dotenv.config({
  path: [new URL("../../../.env", import.meta.url).pathname, ".env"],
});
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import { hasRole, requireRole, verifyPassword } from "@marketplace/auth";
import type {
  Actor,
  ComplianceStandard,
  CredentialStatus,
  EntityLevel,
  PaymentRule,
  PricingType,
  RiskTier,
  Role,
  ServiceFamily,
  ServiceRequestStatus,
  SlotAvailabilityResponse,
} from "@marketplace/contracts";
import {
  assertTransition,
  createPaymentMilestones,
  quoteTotals,
  rankCandidates,
} from "@marketplace/core";
import { pool, transaction } from "@marketplace/database";
import {
  CANONICAL_TRADE_CATALOG,
  CREDENTIAL_GROUPS,
  DEFAULT_COMPLIANCE_STANDARDS,
  evaluateCompliance,
  filterComplianceStandards,
  searchCatalog,
} from "@marketplace/vertical-engine";
import {
  changeOrderSchema,
  createQuoteSchema,
  createRequestSchema,
  evaluateComplianceSchema,
  reviewSchema,
  submitCredentialSchema,
  supportTicketSchema,
  uuid,
} from "@marketplace/validation";

declare module "fastify" {
  interface FastifyRequest {
    actor?: Actor;
  }
}
const app = Fastify({
  logger: { level: process.env.NODE_ENV === "production" ? "info" : "warn" },
  requestIdHeader: "x-request-id",
});
const origins = (process.env.WEB_ORIGIN ?? "").split(",").filter(Boolean);
if (process.env.NODE_ENV === "production") await app.register(helmet);
else await app.register(helmet, { contentSecurityPolicy: false });
await app.register(cors, {
  origin: origins.length ? origins : false,
  credentials: true,
});
await app.register(jwt, {
  secret:
    process.env.JWT_SECRET ?? "development-only-change-me-development-only",
});

const rolesSchema = z
  .preprocess(
    (raw) =>
      typeof raw === "string"
        ? raw === "{}"
          ? []
          : raw.slice(1, -1).split(",")
        : raw,
    z.array(z.string()),
  )
  .transform((roles) => roles as Role[]);
async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    const payload = await request.jwtVerify<{
      sub: string;
      sessionVersion: number;
    }>();
    const rows = await pool.query<{
      id: string;
      session_version: number;
      roles: unknown;
      contractor_id: string | null;
    }>(
      `SELECT u.id,u.session_version,COALESCE(array_agg(ur.role) FILTER(WHERE ur.role IS NOT NULL), '{}') AS roles, COALESCE((SELECT t.contractor_id FROM technicians t WHERE t.user_id=u.id LIMIT 1), (SELECT c.id FROM contractors c WHERE c.owner_user_id=u.id LIMIT 1)) contractor_id FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id WHERE u.id=$1 AND u.deleted_at IS NULL GROUP BY u.id`,
      [payload.sub],
    );
    const user = rows.rows[0];
    if (!user || user.session_version !== payload.sessionVersion)
      throw new Error("SESSION_REVOKED");
    request.actor = {
      id: user.id,
      roles: rolesSchema.parse(user.roles),
      ...(user.contractor_id ? { contractorId: user.contractor_id } : {}),
    };
  } catch {
    await reply
      .code(401)
      .send({
        code: "UNAUTHENTICATED",
        message: "Authentication is required",
        requestId: request.id,
      });
  }
}
function actor(request: FastifyRequest): Actor {
  if (!request.actor) throw new Error("UNAUTHENTICATED");
  return request.actor;
}
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  return schema.parse(input);
}
async function audit(
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await pool.query(
    "INSERT INTO audit_events(actor_id,actor_type,action,entity_type,entity_id,before_state,after_state,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [
      actorId,
      actorId ? "USER" : "SYSTEM",
      action,
      entityType,
      entityId,
      JSON.stringify(before),
      JSON.stringify(after),
      JSON.stringify(metadata),
    ],
  );
}
async function emit(
  aggregateType: string,
  aggregateId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    "INSERT INTO domain_events(aggregate_type,aggregate_id,event_type,payload) VALUES($1,$2,$3,$4)",
    [aggregateType, aggregateId, eventType, JSON.stringify(payload)],
  );
}
async function notify(
  recipientUserId: string,
  eventType: string,
  title: string,
  body: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    "INSERT INTO notifications(recipient_user_id,event_type,title,body,payload) VALUES($1,$2,$3,$4,$5)",
    [recipientUserId, eventType, title, body, JSON.stringify(payload)],
  );
}
function isOps(value: Actor): boolean {
  return hasRole(
    value,
    "OPERATIONS_AGENT",
    "DISPATCHER",
    "ADMIN",
    "SUPER_ADMIN",
  );
}

app.get("/health", async () => ({
  ok: true,
  service: "skilled-hire-api",
  app: "Skilled Hire",
  domain: "skilledhire.ca",
}));
app.post(
  "/v1/auth/login",
  { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } },
  async (request, reply) => {
    const body = parse(
      z.object({ email: z.string().email(), password: z.string().min(1) }),
      request.body,
    );
    const rows = await pool.query<{
      id: string;
      password_hash: string;
      session_version: number;
      roles: unknown;
    }>(
      `SELECT u.id,u.password_hash,u.session_version,COALESCE(array_agg(ur.role) FILTER(WHERE ur.role IS NOT NULL), '{}') AS roles FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id WHERE u.email=$1 AND u.deleted_at IS NULL GROUP BY u.id`,
      [body.email.toLowerCase()],
    );
    const user = rows.rows[0];
    if (!user || !(await verifyPassword(body.password, user.password_hash)))
      return reply
        .code(401)
        .send({
          code: "INVALID_CREDENTIALS",
          message: "Invalid email or password",
        });
    const token = await reply.jwtSign(
      { sub: user.id, sessionVersion: user.session_version },
      { expiresIn: "15m" },
    );
    return { accessToken: token, roles: rolesSchema.parse(user.roles) };
  },
);
app.get("/v1/me", { preHandler: authenticate }, async (request) => ({
  actor: actor(request),
}));
app.get(
  "/v1/verticals",
  async () =>
    (
      await pool.query(
        "SELECT id,slug,name,config FROM verticals WHERE active=true ORDER BY name",
      )
    ).rows,
);
app.get("/v1/verticals/:slug/intake", async (request, reply) => {
  const { slug } = request.params as { slug: string };
  const v = await pool.query<{ id: string; name: string }>(
    "SELECT id, name FROM verticals WHERE slug=$1 AND active=true",
    [slug],
  );
  if (!v.rows[0])
    return reply
      .code(404)
      .send({ code: "NOT_FOUND", message: "Vertical not found" });
  const vertical = v.rows[0];
  let categories = await pool.query<{ id: string; slug: string; name: string }>(
    "SELECT id, slug, name FROM service_categories WHERE vertical_id=$1 AND active=true ORDER BY name",
    [vertical.id],
  );
  if (categories.rows.length === 0) {
    const insertedCat = await pool.query<{
      id: string;
      slug: string;
      name: string;
    }>(
      "INSERT INTO service_categories (vertical_id, slug, name) VALUES ($1, 'general-service', 'General Service') RETURNING id, slug, name",
      [vertical.id],
    );
    await pool.query(
      "INSERT INTO issue_types (category_id, slug, name) VALUES ($1, 'general-repair', 'General Repair & Diagnostic')",
      [insertedCat.rows[0]?.id],
    );
    categories = insertedCat;
  }
  const issues = await pool.query<{
    id: string;
    category_id: string;
    slug: string;
    name: string;
  }>(
    "SELECT id, category_id, slug, name FROM issue_types WHERE category_id IN (SELECT id FROM service_categories WHERE vertical_id=$1) AND active=true ORDER BY name",
    [vertical.id],
  );
  return { vertical, categories: categories.rows, issues: issues.rows };
});

// Catalog & Trade Taxonomy Routes
const createVerticalSchema = z.object({
  slug: z.string().min(2).max(100),
  name: z.string().min(2).max(200),
  family: z
    .enum([
      "MECHANICAL",
      "STRUCTURAL",
      "BUILDING_ENVELOPE",
      "RENOVATION",
      "PROPERTY_MAINTENANCE",
      "SITEWORK",
      "SPECIALTY",
      "GENERAL",
    ])
    .default("GENERAL"),
  description: z.string().max(2000).optional(),
  icon: z.string().max(100).optional(),
  riskTier: z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"]).default("MODERATE"),
  permitAuthority: z.string().max(100).optional(),
  launchReady: z.boolean().default(false),
  displayOrder: z.number().int().default(100),
  config: z.record(z.string(), z.unknown()).default({}),
});

const updateVerticalSchema = createVerticalSchema.partial();

const createCategorySchema = z.object({
  verticalId: uuid,
  slug: z.string().min(2).max(100),
  name: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  riskTier: z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"]).default("MODERATE"),
  launchReady: z.boolean().default(false),
  displayOrder: z.number().int().default(100),
});

const updateCategorySchema = createCategorySchema
  .partial()
  .omit({ verticalId: true });

const createIssueTypeSchema = z.object({
  categoryId: uuid,
  slug: z.string().min(2).max(100),
  name: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  scopeSummary: z.string().max(2000).optional(),
  riskTier: z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"]).default("MODERATE"),
  pricingType: z
    .enum(["HOURLY", "FIXED", "ESTIMATE_REQUIRED"])
    .default("HOURLY"),
  basePriceCents: z.number().int().nonnegative().default(0),
  defaultDurationMinutes: z.number().int().positive().default(120),
  requiresPermit: z.boolean().default(false),
  permitType: z.string().max(100).optional(),
  requiredEvidence: z
    .array(z.string())
    .default(["before_photo", "after_photo"]),
  defaultWarrantyMonths: z.number().int().nonnegative().default(12),
  geographicRestrictions: z.array(z.string()).default(["ON"]),
  tags: z.array(z.string()).default([]),
  launchReady: z.boolean().default(false),
  displayOrder: z.number().int().default(100),
  equipmentFields: z.array(z.string()).default(["manufacturer", "model"]),
});

const updateIssueTypeSchema = createIssueTypeSchema
  .partial()
  .omit({ categoryId: true });

app.get("/v1/catalog", async (request) => {
  const querySchema = z.object({
    geography: z.string().default("*"),
    family: z.string().optional(),
    launchReadyOnly: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
    riskTier: z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"]).optional(),
  });
  const q = querySchema.parse(request.query);

  const queryParams: unknown[] = [];
  const whereClauses: string[] = ["active = true"];
  if (q.family) {
    queryParams.push(q.family);
    whereClauses.push(`family = $${queryParams.length}`);
  }
  if (q.launchReadyOnly) {
    whereClauses.push("launch_ready = true");
  }
  if (q.riskTier) {
    queryParams.push(q.riskTier);
    whereClauses.push(`risk_tier = $${queryParams.length}`);
  }

  const verticalsResult = await pool.query<{
    id: string;
    slug: string;
    name: string;
    family: ServiceFamily;
    description: string | null;
    icon: string | null;
    risk_tier: RiskTier;
    permit_authority: string | null;
    launch_ready: boolean;
    display_order: number;
    active: boolean;
    config: unknown;
  }>(
    `SELECT id, slug, name, family, description, icon, risk_tier, permit_authority, launch_ready, display_order, active, config
     FROM verticals
     WHERE ${whereClauses.join(" AND ")}
     ORDER BY display_order ASC, name ASC`,
    queryParams,
  );

  const catWhere: string[] = ["active = true"];
  if (q.launchReadyOnly) catWhere.push("launch_ready = true");

  const categoriesResult = await pool.query<{
    id: string;
    vertical_id: string;
    slug: string;
    name: string;
    description: string | null;
    risk_tier: RiskTier;
    launch_ready: boolean;
    display_order: number;
    active: boolean;
  }>(
    `SELECT id, vertical_id, slug, name, description, risk_tier, launch_ready, display_order, active
     FROM service_categories
     WHERE ${catWhere.join(" AND ")}
     ORDER BY display_order ASC, name ASC`,
  );

  const issueWhere: string[] = ["active = true"];
  if (q.launchReadyOnly) issueWhere.push("launch_ready = true");

  const variantsResult = await pool.query<{
    id: string;
    category_id: string;
    slug: string;
    name: string;
    description: string | null;
    scope_summary: string | null;
    risk_tier: RiskTier;
    pricing_type: PricingType;
    base_price_cents: string;
    default_duration_minutes: number;
    requires_permit: boolean;
    permit_type: string | null;
    required_evidence: unknown;
    default_warranty_months: number;
    geographic_restrictions: unknown;
    tags: unknown;
    launch_ready: boolean;
    display_order: number;
    active: boolean;
  }>(
    `SELECT id, category_id, slug, name, description, scope_summary, risk_tier, pricing_type,
            base_price_cents, default_duration_minutes, requires_permit, permit_type,
            required_evidence, default_warranty_months, geographic_restrictions, tags, launch_ready, display_order, active
     FROM issue_types
     WHERE ${issueWhere.join(" AND ")}
     ORDER BY display_order ASC, name ASC`,
  );

  const variantsByCat = new Map<string, typeof variantsResult.rows>();
  for (const variant of variantsResult.rows) {
    const list = variantsByCat.get(variant.category_id) ?? [];
    list.push(variant);
    variantsByCat.set(variant.category_id, list);
  }

  const catsByVertical = new Map<string, Array<unknown>>();
  for (const category of categoriesResult.rows) {
    const variants = (variantsByCat.get(category.id) ?? []).map((v) => ({
      ...v,
      basePriceCents: Number(v.base_price_cents),
    }));
    if (q.launchReadyOnly && variants.length === 0) continue;
    const catObj = {
      ...category,
      variants,
    };
    const list = catsByVertical.get(category.vertical_id) ?? [];
    list.push(catObj);
    catsByVertical.set(category.vertical_id, list);
  }

  return verticalsResult.rows
    .map((v) => ({
      ...v,
      categories: catsByVertical.get(v.id) ?? [],
    }))
    .filter(
      (v) => !q.launchReadyOnly || (v.categories && v.categories.length > 0),
    );
});

app.get("/v1/catalog/search", async (request) => {
  const querySchema = z.object({
    q: z.string().default(""),
    geography: z.string().default("*"),
    family: z.string().optional(),
    launchReadyOnly: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
    maxRiskTier: z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"]).optional(),
  });
  const q = querySchema.parse(request.query);
  const queryTokens = q.q.trim().toLowerCase().split(/\s+/).filter(Boolean);

  const searchWhere: string[] = [
    "i.active = true",
    "c.active = true",
    "v.active = true",
  ];
  const searchParams: unknown[] = [];
  if (q.family) {
    searchParams.push(q.family);
    searchWhere.push(`v.family = $${searchParams.length}`);
  }
  if (q.launchReadyOnly) {
    searchWhere.push(
      "i.launch_ready = true",
      "c.launch_ready = true",
      "v.launch_ready = true",
    );
  }

  const results = await pool.query<{
    vertical_id: string;
    vertical_slug: string;
    vertical_name: string;
    vertical_family: ServiceFamily;
    category_id: string;
    category_slug: string;
    category_name: string;
    variant_id: string;
    variant_slug: string;
    variant_name: string;
    description: string | null;
    scope_summary: string | null;
    risk_tier: RiskTier;
    pricing_type: PricingType;
    base_price_cents: string;
    requires_permit: boolean;
    permit_type: string | null;
    launch_ready: boolean;
    geographic_restrictions: unknown;
    tags: unknown;
  }>(
    `SELECT v.id as vertical_id, v.slug as vertical_slug, v.name as vertical_name, v.family as vertical_family,
            c.id as category_id, c.slug as category_slug, c.name as category_name,
            i.id as variant_id, i.slug as variant_slug, i.name as variant_name,
            i.description, i.scope_summary, i.risk_tier, i.pricing_type, i.base_price_cents,
            i.requires_permit, i.permit_type, i.launch_ready,
            i.geographic_restrictions, i.tags
     FROM issue_types i
     JOIN service_categories c ON c.id = i.category_id
     JOIN verticals v ON v.id = c.vertical_id
     WHERE ${searchWhere.join(" AND ")}
     ORDER BY v.display_order ASC, c.display_order ASC, i.display_order ASC`,
    searchParams,
  );

  const riskTierRank: Record<RiskTier, number> = {
    LOW: 1,
    MODERATE: 2,
    HIGH: 3,
    CRITICAL: 4,
  };
  const maxTier = q.maxRiskTier ? riskTierRank[q.maxRiskTier] : 4;

  const scored = results.rows
    .filter((row) => riskTierRank[row.risk_tier] <= maxTier)
    .filter((row) => {
      if (q.geography === "*") return true;
      const geos = Array.isArray(row.geographic_restrictions)
        ? (row.geographic_restrictions as string[])
        : [];
      return (
        geos.length === 0 ||
        geos.includes("*") ||
        geos.map((g) => g.toUpperCase()).includes(q.geography.toUpperCase())
      );
    })
    .map((row) => {
      let matchScore = 0;
      const tags = Array.isArray(row.tags) ? (row.tags as string[]) : [];
      const textToMatch =
        `${row.vertical_name} ${row.category_name} ${row.variant_name} ${row.description ?? ""} ${row.scope_summary ?? ""} ${tags.join(" ")}`.toLowerCase();

      if (queryTokens.length === 0) {
        matchScore = 50;
      } else {
        for (const token of queryTokens) {
          if (row.variant_name.toLowerCase().includes(token)) matchScore += 50;
          else if (row.category_name.toLowerCase().includes(token))
            matchScore += 30;
          else if (row.vertical_name.toLowerCase().includes(token))
            matchScore += 20;
          else if (tags.some((t) => t.toLowerCase().includes(token)))
            matchScore += 40;
          else if (textToMatch.includes(token)) matchScore += 10;
        }
      }

      return {
        verticalId: row.vertical_id,
        verticalSlug: row.vertical_slug,
        verticalName: row.vertical_name,
        verticalFamily: row.vertical_family,
        categoryId: row.category_id,
        categorySlug: row.category_slug,
        categoryName: row.category_name,
        variantId: row.variant_id,
        variantSlug: row.variant_slug,
        variantName: row.variant_name,
        description: row.description ?? "",
        riskTier: row.risk_tier,
        pricingType: row.pricing_type,
        basePriceCents: Number(row.base_price_cents),
        requiresPermit: row.requires_permit,
        permitType: row.permit_type,
        launchReady: row.launch_ready,
        matchScore,
      };
    });

  return scored
    .filter((r) => r.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore);
});

app.get("/v1/catalog/services/:slug", async (request, reply) => {
  const { slug } = request.params as { slug: string };
  const v = await pool.query<{
    id: string;
    slug: string;
    name: string;
    family: ServiceFamily;
    description: string | null;
    icon: string | null;
    risk_tier: RiskTier;
    permit_authority: string | null;
    launch_ready: boolean;
    display_order: number;
    config: unknown;
  }>(
    "SELECT id, slug, name, family, description, icon, risk_tier, permit_authority, launch_ready, display_order, config FROM verticals WHERE slug=$1 AND active=true",
    [slug],
  );
  if (!v.rows[0])
    return reply
      .code(404)
      .send({ code: "NOT_FOUND", message: "Service vertical not found" });
  const vertical = v.rows[0];

  const categories = await pool.query<{
    id: string;
    slug: string;
    name: string;
    description: string | null;
    risk_tier: RiskTier;
    launch_ready: boolean;
    display_order: number;
  }>(
    "SELECT id, slug, name, description, risk_tier, launch_ready, display_order FROM service_categories WHERE vertical_id=$1 AND active=true ORDER BY display_order ASC, name ASC",
    [vertical.id],
  );

  const variants = await pool.query<{
    id: string;
    category_id: string;
    slug: string;
    name: string;
    description: string | null;
    scope_summary: string | null;
    risk_tier: RiskTier;
    pricing_type: PricingType;
    base_price_cents: string;
    default_duration_minutes: number;
    requires_permit: boolean;
    permit_type: string | null;
    required_evidence: unknown;
    default_warranty_months: number;
    geographic_restrictions: unknown;
    tags: unknown;
    launch_ready: boolean;
    display_order: number;
  }>(
    `SELECT id, category_id, slug, name, description, scope_summary, risk_tier, pricing_type,
            base_price_cents, default_duration_minutes, requires_permit, permit_type,
            required_evidence, default_warranty_months, geographic_restrictions, tags, launch_ready, display_order
     FROM issue_types
     WHERE category_id IN (SELECT id FROM service_categories WHERE vertical_id=$1) AND active=true
     ORDER BY display_order ASC, name ASC`,
    [vertical.id],
  );

  const variantsByCat = new Map<string, typeof variants.rows>();
  for (const variant of variants.rows) {
    const list = variantsByCat.get(variant.category_id) ?? [];
    list.push(variant);
    variantsByCat.set(variant.category_id, list);
  }

  return {
    vertical,
    categories: categories.rows.map((cat) => ({
      ...cat,
      variants: (variantsByCat.get(cat.id) ?? []).map((v) => ({
        ...v,
        basePriceCents: Number(v.base_price_cents),
      })),
    })),
  };
});

// Admin Catalog Management Endpoints
app.post(
  "/v1/admin/catalog/verticals",
  { preHandler: authenticate },
  async (request, reply) => {
    requireRole(actor(request), "ADMIN", "SUPER_ADMIN");
    const body = parse(createVerticalSchema, request.body);
    const result = await pool.query<{ id: string }>(
      `INSERT INTO verticals(slug, name, family, description, icon, risk_tier, permit_authority, launch_ready, display_order, config)
     VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
      [
        body.slug,
        body.name,
        body.family,
        body.description ?? null,
        body.icon ?? null,
        body.riskTier,
        body.permitAuthority ?? null,
        body.launchReady,
        body.displayOrder,
        JSON.stringify(body.config),
      ],
    );
    const id = result.rows[0]?.id;
    await audit(
      actor(request).id,
      "VERTICAL_CREATED",
      "VERTICAL",
      id!,
      null,
      body,
    );
    return reply.code(201).send({ id, ...body });
  },
);

app.patch(
  "/v1/admin/catalog/verticals/:id",
  { preHandler: authenticate },
  async (request, reply) => {
    requireRole(actor(request), "ADMIN", "SUPER_ADMIN");
    const { id } = parse(z.object({ id: uuid }), request.params);
    const body = parse(updateVerticalSchema, request.body);
    const existing = await pool.query("SELECT * FROM verticals WHERE id=$1", [
      id,
    ]);
    if (!existing.rows[0])
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: "Vertical not found" });

    const fields: string[] = [];
    const values: unknown[] = [];
    if (body.name !== undefined) {
      values.push(body.name);
      fields.push(`name=$${values.length}`);
    }
    if (body.slug !== undefined) {
      values.push(body.slug);
      fields.push(`slug=$${values.length}`);
    }
    if (body.family !== undefined) {
      values.push(body.family);
      fields.push(`family=$${values.length}`);
    }
    if (body.description !== undefined) {
      values.push(body.description);
      fields.push(`description=$${values.length}`);
    }
    if (body.icon !== undefined) {
      values.push(body.icon);
      fields.push(`icon=$${values.length}`);
    }
    if (body.riskTier !== undefined) {
      values.push(body.riskTier);
      fields.push(`risk_tier=$${values.length}`);
    }
    if (body.permitAuthority !== undefined) {
      values.push(body.permitAuthority);
      fields.push(`permit_authority=$${values.length}`);
    }
    if (body.launchReady !== undefined) {
      values.push(body.launchReady);
      fields.push(`launch_ready=$${values.length}`);
    }
    if (body.displayOrder !== undefined) {
      values.push(body.displayOrder);
      fields.push(`display_order=$${values.length}`);
    }
    if (body.config !== undefined) {
      values.push(JSON.stringify(body.config));
      fields.push(`config=$${values.length}`);
    }

    if (fields.length > 0) {
      values.push(id);
      await pool.query(
        `UPDATE verticals SET ${fields.join(", ")}, updated_at=now() WHERE id=$${values.length}`,
        values,
      );
      await audit(
        actor(request).id,
        "VERTICAL_UPDATED",
        "VERTICAL",
        id,
        existing.rows[0],
        body,
      );
    }
    return reply.send({ id, updated: true });
  },
);

app.post(
  "/v1/admin/catalog/categories",
  { preHandler: authenticate },
  async (request, reply) => {
    requireRole(actor(request), "ADMIN", "SUPER_ADMIN");
    const body = parse(createCategorySchema, request.body);
    const result = await pool.query<{ id: string }>(
      `INSERT INTO service_categories(vertical_id, slug, name, description, risk_tier, launch_ready, display_order)
     VALUES($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
      [
        body.verticalId,
        body.slug,
        body.name,
        body.description ?? null,
        body.riskTier,
        body.launchReady,
        body.displayOrder,
      ],
    );
    const id = result.rows[0]?.id;
    await audit(
      actor(request).id,
      "SERVICE_CATEGORY_CREATED",
      "SERVICE_CATEGORY",
      id!,
      null,
      body,
    );
    return reply.code(201).send({ id, ...body });
  },
);

app.patch(
  "/v1/admin/catalog/categories/:id",
  { preHandler: authenticate },
  async (request, reply) => {
    requireRole(actor(request), "ADMIN", "SUPER_ADMIN");
    const { id } = parse(z.object({ id: uuid }), request.params);
    const body = parse(updateCategorySchema, request.body);
    const existing = await pool.query(
      "SELECT * FROM service_categories WHERE id=$1",
      [id],
    );
    if (!existing.rows[0])
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: "Category not found" });

    const fields: string[] = [];
    const values: unknown[] = [];
    if (body.name !== undefined) {
      values.push(body.name);
      fields.push(`name=$${values.length}`);
    }
    if (body.slug !== undefined) {
      values.push(body.slug);
      fields.push(`slug=$${values.length}`);
    }
    if (body.description !== undefined) {
      values.push(body.description);
      fields.push(`description=$${values.length}`);
    }
    if (body.riskTier !== undefined) {
      values.push(body.riskTier);
      fields.push(`risk_tier=$${values.length}`);
    }
    if (body.launchReady !== undefined) {
      values.push(body.launchReady);
      fields.push(`launch_ready=$${values.length}`);
    }
    if (body.displayOrder !== undefined) {
      values.push(body.displayOrder);
      fields.push(`display_order=$${values.length}`);
    }

    if (fields.length > 0) {
      values.push(id);
      await pool.query(
        `UPDATE service_categories SET ${fields.join(", ")} WHERE id=$${values.length}`,
        values,
      );
      await audit(
        actor(request).id,
        "SERVICE_CATEGORY_UPDATED",
        "SERVICE_CATEGORY",
        id,
        existing.rows[0],
        body,
      );
    }
    return reply.send({ id, updated: true });
  },
);

app.post(
  "/v1/admin/catalog/issue-types",
  { preHandler: authenticate },
  async (request, reply) => {
    requireRole(actor(request), "ADMIN", "SUPER_ADMIN");
    const body = parse(createIssueTypeSchema, request.body);
    const result = await pool.query<{ id: string }>(
      `INSERT INTO issue_types(
       category_id, slug, name, description, scope_summary, risk_tier, pricing_type,
       base_price_cents, default_duration_minutes, requires_permit, permit_type,
       required_evidence, default_warranty_months, geographic_restrictions, tags, launch_ready, display_order, equipment_fields
     )
     VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     RETURNING id`,
      [
        body.categoryId,
        body.slug,
        body.name,
        body.description ?? null,
        body.scopeSummary ?? null,
        body.riskTier,
        body.pricingType,
        body.basePriceCents,
        body.defaultDurationMinutes,
        body.requiresPermit,
        body.permitType ?? null,
        JSON.stringify(body.requiredEvidence),
        body.defaultWarrantyMonths,
        JSON.stringify(body.geographicRestrictions),
        JSON.stringify(body.tags),
        body.launchReady,
        body.displayOrder,
        JSON.stringify(body.equipmentFields),
      ],
    );
    const id = result.rows[0]?.id;
    await audit(
      actor(request).id,
      "ISSUE_TYPE_CREATED",
      "ISSUE_TYPE",
      id!,
      null,
      body,
    );
    return reply.code(201).send({ id, ...body });
  },
);

app.patch(
  "/v1/admin/catalog/issue-types/:id",
  { preHandler: authenticate },
  async (request, reply) => {
    requireRole(actor(request), "ADMIN", "SUPER_ADMIN");
    const { id } = parse(z.object({ id: uuid }), request.params);
    const body = parse(updateIssueTypeSchema, request.body);
    const existing = await pool.query("SELECT * FROM issue_types WHERE id=$1", [
      id,
    ]);
    if (!existing.rows[0])
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: "Issue type / variant not found" });

    const fields: string[] = [];
    const values: unknown[] = [];
    if (body.name !== undefined) {
      values.push(body.name);
      fields.push(`name=$${values.length}`);
    }
    if (body.slug !== undefined) {
      values.push(body.slug);
      fields.push(`slug=$${values.length}`);
    }
    if (body.description !== undefined) {
      values.push(body.description);
      fields.push(`description=$${values.length}`);
    }
    if (body.scopeSummary !== undefined) {
      values.push(body.scopeSummary);
      fields.push(`scope_summary=$${values.length}`);
    }
    if (body.riskTier !== undefined) {
      values.push(body.riskTier);
      fields.push(`risk_tier=$${values.length}`);
    }
    if (body.pricingType !== undefined) {
      values.push(body.pricingType);
      fields.push(`pricing_type=$${values.length}`);
    }
    if (body.basePriceCents !== undefined) {
      values.push(body.basePriceCents);
      fields.push(`base_price_cents=$${values.length}`);
    }
    if (body.defaultDurationMinutes !== undefined) {
      values.push(body.defaultDurationMinutes);
      fields.push(`default_duration_minutes=$${values.length}`);
    }
    if (body.requiresPermit !== undefined) {
      values.push(body.requiresPermit);
      fields.push(`requires_permit=$${values.length}`);
    }
    if (body.permitType !== undefined) {
      values.push(body.permitType);
      fields.push(`permit_type=$${values.length}`);
    }
    if (body.requiredEvidence !== undefined) {
      values.push(JSON.stringify(body.requiredEvidence));
      fields.push(`required_evidence=$${values.length}`);
    }
    if (body.defaultWarrantyMonths !== undefined) {
      values.push(body.defaultWarrantyMonths);
      fields.push(`default_warranty_months=$${values.length}`);
    }
    if (body.geographicRestrictions !== undefined) {
      values.push(JSON.stringify(body.geographicRestrictions));
      fields.push(`geographic_restrictions=$${values.length}`);
    }
    if (body.tags !== undefined) {
      values.push(JSON.stringify(body.tags));
      fields.push(`tags=$${values.length}`);
    }
    if (body.launchReady !== undefined) {
      values.push(body.launchReady);
      fields.push(`launch_ready=$${values.length}`);
    }
    if (body.displayOrder !== undefined) {
      values.push(body.displayOrder);
      fields.push(`display_order=$${values.length}`);
    }

    if (fields.length > 0) {
      values.push(id);
      await pool.query(
        `UPDATE issue_types SET ${fields.join(", ")} WHERE id=$${values.length}`,
        values,
      );
      await audit(
        actor(request).id,
        "ISSUE_TYPE_UPDATED",
        "ISSUE_TYPE",
        id,
        existing.rows[0],
        body,
      );
    }
    return reply.send({ id, updated: true });
  },
);

app.get("/v1/compliance/groups", async () => {
  try {
    const result = await pool.query<{
      code: string;
      name: string;
      description: string;
      display_order: number;
      icon: string;
    }>(
      "SELECT code, name, description, display_order, icon FROM credential_groups ORDER BY display_order ASC",
    );
    if (result.rows.length) {
      return result.rows.map((r) => ({
        code: r.code,
        name: r.name,
        description: r.description,
        displayOrder: r.display_order,
        icon: r.icon,
      }));
    }
  } catch {
    /* Fall back to in-memory groups */
  }
  return CREDENTIAL_GROUPS;
});

app.get("/v1/compliance/standards", async (request) => {
  const querySchema = z.object({
    vertical: z.string().default("*"),
    geography: z.string().default("*"),
    entityLevel: z.enum(["CONTRACTOR", "TECHNICIAN", "EITHER"]).optional(),
  });
  const q = querySchema.parse(request.query);
  try {
    const result = await pool.query<{
      id: string;
      group_code: string;
      credential_code: string;
      name: string;
      description: string;
      vertical_slug: string;
      geography: string;
      entity_level: EntityLevel;
      requirement_level: "MANDATORY" | "RECOMMENDED";
      issuing_authority: string;
      legal_reference: string | null;
      verification_method: "DOCUMENT_UPLOAD" | "REGISTRY_API" | "MANUAL_AUDIT";
      validity_period_months: number | null;
      active: boolean;
    }>(
      `SELECT id, group_code, credential_code, name, description, vertical_slug, geography, entity_level,
              requirement_level, issuing_authority, legal_reference, verification_method, validity_period_months, active
       FROM compliance_standards
       WHERE active = true
         AND (vertical_slug = '*' OR lower(vertical_slug) = lower($1))
         AND (geography = '*' OR upper(geography) = upper($2))
         ${q.entityLevel && q.entityLevel !== "EITHER" ? "AND (entity_level = 'EITHER' OR entity_level = $3)" : ""}
       ORDER BY group_code, requirement_level DESC, name`,
      q.entityLevel && q.entityLevel !== "EITHER"
        ? [q.vertical, q.geography, q.entityLevel]
        : [q.vertical, q.geography],
    );
    if (result.rows.length) {
      return result.rows.map((r): ComplianceStandard => ({
        id: r.id,
        groupCode: r.group_code as any,
        credentialCode: r.credential_code,
        name: r.name,
        description: r.description,
        verticalSlug: r.vertical_slug,
        geography: r.geography,
        entityLevel: r.entity_level,
        requirementLevel: r.requirement_level,
        issuingAuthority: r.issuing_authority,
        legalReference: r.legal_reference ?? undefined,
        verificationMethod: r.verification_method,
        validityPeriodMonths: r.validity_period_months,
        active: r.active,
      }));
    }
  } catch {
    /* Fall back to built-in catalog */
  }
  return filterComplianceStandards(
    DEFAULT_COMPLIANCE_STANDARDS,
    q.vertical,
    q.geography,
    q.entityLevel,
  );
});

app.post("/v1/compliance/evaluate", async (request, reply) => {
  const body = parse(evaluateComplianceSchema, request.body);
  const applicable = filterComplianceStandards(
    DEFAULT_COMPLIANCE_STANDARDS,
    body.verticalSlug,
    body.geography,
    body.entityLevel,
  );
  const scorecard = evaluateCompliance(applicable, body.credentials ?? [], {
    verticalSlug: body.verticalSlug,
    geography: body.geography,
    entityLevel: body.entityLevel,
  });
  let breakdowns: { contractor: unknown; technician: unknown } | undefined;
  if (!body.entityLevel || body.entityLevel === "EITHER") {
    const contractorStandards = filterComplianceStandards(
      DEFAULT_COMPLIANCE_STANDARDS,
      body.verticalSlug,
      body.geography,
      "CONTRACTOR",
    );
    const techStandards = filterComplianceStandards(
      DEFAULT_COMPLIANCE_STANDARDS,
      body.verticalSlug,
      body.geography,
      "TECHNICIAN",
    );
    breakdowns = {
      contractor: evaluateCompliance(
        contractorStandards,
        body.credentials ?? [],
        { ...body, entityLevel: "CONTRACTOR" },
      ),
      technician: evaluateCompliance(techStandards, body.credentials ?? [], {
        ...body,
        entityLevel: "TECHNICIAN",
      }),
    };
  }
  try {
    await pool.query(
      `INSERT INTO compliance_evaluations (vertical_slug, geography, overall_status, score_bps, summary)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        body.verticalSlug,
        body.geography,
        scorecard.overallStatus,
        scorecard.scoreBps,
        JSON.stringify(scorecard),
      ],
    );
  } catch {
    /* Evaluation log table non-blocking */
  }
  return reply
    .code(200)
    .send({ ...scorecard, ...(breakdowns ? { breakdowns } : {}) });
});

app.get(
  "/v1/contractors/:id/compliance",
  { preHandler: authenticate },
  async (request, reply) => {
    const contractorId = parse(z.object({ id: uuid }), request.params).id;
    const isOwner = actor(request).contractorId === contractorId;
    if (!isOwner && !isOps(actor(request)))
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: "Not permitted" });
    const contractorRows = await pool.query<{
      name: string;
      service_areas: unknown;
      vertical_ids: unknown;
    }>(
      "SELECT name, service_areas, vertical_ids FROM contractors WHERE id = $1",
      [contractorId],
    );
    const contractor = contractorRows.rows[0];
    if (!contractor)
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: "Contractor not found" });
    const credRows = await pool.query<{
      code: string;
      geography: string;
      status: CredentialStatus;
      expiry_date: string | null;
      document_key: string | null;
    }>(
      `SELECT cr.code, cr.geography, cr.status, cr.expiry_date::text, cr.document_key
     FROM credentials cr
     WHERE cr.contractor_id = $1
        OR cr.technician_id IN (SELECT id FROM technicians WHERE contractor_id = $1)`,
      [contractorId],
    );
    const regions = (
      Array.isArray(contractor.service_areas)
        ? contractor.service_areas
        : ["ON"]
    ) as string[];
    const geography = regions[0] ?? "ON";
    const query = request.query as
      { vertical?: string; entityLevel?: EntityLevel } | undefined;
    const queryVertical = query?.vertical;
    let verticalSlug = queryVertical ?? "hvac";
    if (
      !queryVertical &&
      Array.isArray(contractor.vertical_ids) &&
      contractor.vertical_ids.length > 0
    ) {
      const vRows = await pool.query<{ slug: string }>(
        "SELECT slug FROM verticals WHERE id = $1 LIMIT 1",
        [contractor.vertical_ids[0]],
      );
      if (vRows.rows[0]?.slug) verticalSlug = vRows.rows[0].slug;
    }
    const entityLevel = query?.entityLevel;
    const applicable = filterComplianceStandards(
      DEFAULT_COMPLIANCE_STANDARDS,
      verticalSlug,
      geography,
      entityLevel,
    );
    const creds = credRows.rows.map((c) => ({
      code: c.code,
      geography: c.geography,
      status: c.status,
      expiryDate: c.expiry_date,
      documentKey: c.document_key,
    }));
    const scorecard = evaluateCompliance(applicable, creds, {
      verticalSlug,
      geography,
      entityLevel,
    });
    const contractorStandards = filterComplianceStandards(
      DEFAULT_COMPLIANCE_STANDARDS,
      verticalSlug,
      geography,
      "CONTRACTOR",
    );
    const techStandards = filterComplianceStandards(
      DEFAULT_COMPLIANCE_STANDARDS,
      verticalSlug,
      geography,
      "TECHNICIAN",
    );
    const breakdowns = {
      contractor: evaluateCompliance(contractorStandards, creds, {
        verticalSlug,
        geography,
        entityLevel: "CONTRACTOR",
      }),
      technician: evaluateCompliance(techStandards, creds, {
        verticalSlug,
        geography,
        entityLevel: "TECHNICIAN",
      }),
    };
    return {
      contractorId,
      contractorName: contractor.name,
      scorecard,
      breakdowns,
    };
  },
);

app.post(
  "/v1/credentials/submit",
  { preHandler: authenticate },
  async (request, reply) => {
    requireRole(
      actor(request),
      "CONTRACTOR_OWNER",
      "CONTRACTOR_MANAGER",
      "TECHNICIAN",
      "ADMIN",
      "SUPER_ADMIN",
    );
    const body = parse(submitCredentialSchema, request.body);
    const actorId = actor(request).id;
    const contractorId = actor(request).contractorId;
    let targetContractorId: string | null = null;
    let targetTechnicianId: string | null = null;
    if (body.entityType === "CONTRACTOR") {
      if (!contractorId)
        return reply
          .code(400)
          .send({
            code: "CONTRACTOR_REQUIRED",
            message: "Must belong to a contractor",
          });
      targetContractorId = contractorId;
    } else {
      if (body.technicianId) targetTechnicianId = body.technicianId;
      else {
        const tech = await pool.query<{ id: string }>(
          "SELECT id FROM technicians WHERE user_id = $1 LIMIT 1",
          [actorId],
        );
        if (tech.rows[0]?.id) targetTechnicianId = tech.rows[0].id;
        else
          return reply
            .code(400)
            .send({
              code: "TECHNICIAN_NOT_FOUND",
              message: "No technician profile linked",
            });
      }
    }
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO credentials (contractor_id, technician_id, code, geography, status, expiry_date, document_key)
     VALUES ($1, $2, $3, $4, 'PENDING', $5, $6)
     RETURNING id`,
      [
        targetContractorId,
        targetTechnicianId,
        body.code,
        body.geography,
        body.expiryDate ?? null,
        body.documentKey,
      ],
    );
    const credId = inserted.rows[0]?.id;
    if (!credId) throw new Error("INSERT_FAILED");
    await audit(
      actorId,
      "CREDENTIAL_SUBMITTED",
      "CREDENTIAL",
      credId,
      null,
      body,
    );
    return reply.code(201).send({ id: credId, status: "PENDING" });
  },
);

app.post(
  "/v1/properties",
  { preHandler: authenticate },
  async (request, reply) => {
    requireRole(actor(request), "CUSTOMER");
    const body = parse(
      z.object({
        label: z.string().min(1).max(100),
        addressLine1: z.string().min(1).max(200),
        city: z.string().min(1).max(100),
        region: z.string().min(1).max(100),
        postalCode: z.string().min(3).max(20),
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
      }),
      request.body,
    );
    const inserted = await pool.query<{ id: string }>(
      "INSERT INTO properties(customer_id,label,address_line1,city,region,postal_code,latitude,longitude) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
      [
        actor(request).id,
        body.label,
        body.addressLine1,
        body.city,
        body.region,
        body.postalCode,
        body.latitude ?? null,
        body.longitude ?? null,
      ],
    );
    const id = inserted.rows[0]?.id;
    if (!id) throw new Error("INSERT_FAILED");
    await audit(
      actor(request).id,
      "PROPERTY_CREATED",
      "PROPERTY",
      id,
      null,
      body,
    );
    return reply.code(201).send({ id });
  },
);
app.get("/v1/properties", { preHandler: authenticate }, async (request) => {
  return (
    await pool.query<{
      id: string;
      label: string;
      address_line1: string;
      city: string;
      region: string;
      postal_code: string;
    }>(
      "SELECT id, label, address_line1, city, region, postal_code FROM properties WHERE customer_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC",
      [actor(request).id],
    )
  ).rows;
});
app.post(
  "/v1/service-requests",
  { preHandler: authenticate },
  async (request, reply) => {
    requireRole(actor(request), "CUSTOMER");
    const body = parse(createRequestSchema, request.body);
    const valid = await pool.query<{ property_id: string }>(
      `SELECT p.id property_id FROM properties p JOIN issue_types i ON i.id=$4 AND i.active=true JOIN service_categories c ON c.id=i.category_id AND c.id=$3 AND c.active=true JOIN verticals v ON v.id=c.vertical_id AND v.id=$5 AND v.active=true WHERE p.id=$1 AND p.customer_id=$2 AND p.deleted_at IS NULL`,
      [
        body.propertyId,
        actor(request).id,
        body.categoryId,
        body.issueTypeId,
        body.verticalId,
      ],
    );
    if (!valid.rowCount)
      return reply
        .code(422)
        .send({
          code: "INVALID_REQUEST_CONFIGURATION",
          message: "Property or vertical service selection is invalid",
        });
    const result = await pool.query<{ id: string }>(
      "INSERT INTO service_requests(customer_id,property_id,vertical_id,category_id,issue_type_id,urgency,status,description,equipment,preferred_starts_at,preferred_ends_at,attachment_keys) VALUES($1,$2,$3,$4,$5,$6,'SUBMITTED',$7,$8,$9,$10,$11) RETURNING id",
      [
        actor(request).id,
        body.propertyId,
        body.verticalId,
        body.categoryId,
        body.issueTypeId,
        body.urgency,
        body.description,
        JSON.stringify(body.equipment),
        body.preferredStartsAt ?? null,
        body.preferredEndsAt ?? null,
        JSON.stringify(body.attachmentKeys),
      ],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("INSERT_FAILED");
    await audit(
      actor(request).id,
      "SERVICE_REQUEST_SUBMITTED",
      "SERVICE_REQUEST",
      id,
      { status: "DRAFT" },
      { status: "SUBMITTED" },
    );
    return reply.code(201).send({ id, status: "SUBMITTED" });
  },
);
app.get(
  "/v1/service-requests",
  { preHandler: authenticate },
  async (request) => {
    const isOperations = isOps(actor(request));
    const q = isOperations
      ? `SELECT sr.id, sr.urgency, sr.status, sr.description, sr.created_at, p.label as property_label, p.city, v.name as vertical_name, c.name as category_name, i.name as issue_name, u.display_name as customer_name
       FROM service_requests sr
       JOIN properties p ON p.id = sr.property_id
       JOIN verticals v ON v.id = sr.vertical_id
       JOIN service_categories c ON c.id = sr.category_id
       JOIN issue_types i ON i.id = sr.issue_type_id
       JOIN users u ON u.id = sr.customer_id
       ORDER BY sr.created_at DESC LIMIT 50`
      : `SELECT sr.id, sr.urgency, sr.status, sr.description, sr.created_at, p.label as property_label, p.city, v.name as vertical_name, c.name as category_name, i.name as issue_name
       FROM service_requests sr
       JOIN properties p ON p.id = sr.property_id
       JOIN verticals v ON v.id = sr.vertical_id
       JOIN service_categories c ON c.id = sr.category_id
       JOIN issue_types i ON i.id = sr.issue_type_id
       WHERE sr.customer_id = $1
       ORDER BY sr.created_at DESC LIMIT 50`;
    const params = isOperations ? [] : [actor(request).id];
    return (await pool.query(q, params)).rows;
  },
);
app.get(
  "/v1/service-requests/:id",
  { preHandler: authenticate },
  async (request, reply) => {
    const id = parse(z.object({ id: uuid }), request.params).id;
    const rows = await pool.query(
      `SELECT r.*,j.id job_id,j.technician_id,j.contractor_id,t.display_name technician_name,c.name contractor_name FROM service_requests r LEFT JOIN jobs j ON j.service_request_id=r.id LEFT JOIN technicians t ON t.id=j.technician_id LEFT JOIN contractors c ON c.id=j.contractor_id WHERE r.id=$1`,
      [id],
    );
    const result = rows.rows[0] as
      { customer_id: string; contractor_id?: string | null } | undefined;
    if (!result)
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: "Service request not found" });
    if (
      !isOps(actor(request)) &&
      result.customer_id !== actor(request).id &&
      result.contractor_id !== actor(request).contractorId
    )
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: "Not permitted" });
    return result;
  },
);
app.get("/v1/jobs", { preHandler: authenticate }, async (request) => {
  const currentActor = actor(request);
  let q: string;
  let params: unknown[];
  if (isOps(currentActor)) {
    q = `SELECT j.id, j.status, j.service_request_id, j.contractor_id, j.technician_id, j.created_at, j.updated_at,
                c.name as contractor_name, t.display_name as technician_name,
                sr.urgency, sr.description as request_description, p.address_line1, p.city
         FROM jobs j
         JOIN contractors c ON c.id = j.contractor_id
         JOIN technicians t ON t.id = j.technician_id
         JOIN service_requests sr ON sr.id = j.service_request_id
         JOIN properties p ON p.id = sr.property_id
         ORDER BY j.created_at DESC LIMIT 50`;
    params = [];
  } else if (currentActor.contractorId) {
    q = `SELECT j.id, j.status, j.service_request_id, j.contractor_id, j.technician_id, j.created_at, j.updated_at,
                c.name as contractor_name, t.display_name as technician_name,
                sr.urgency, sr.description as request_description, p.address_line1, p.city
         FROM jobs j
         JOIN contractors c ON c.id = j.contractor_id
         JOIN technicians t ON t.id = j.technician_id
         JOIN service_requests sr ON sr.id = j.service_request_id
         JOIN properties p ON p.id = sr.property_id
         WHERE j.contractor_id = $1
         ORDER BY j.created_at DESC LIMIT 50`;
    params = [currentActor.contractorId];
  } else {
    q = `SELECT j.id, j.status, j.service_request_id, j.contractor_id, j.technician_id, j.created_at, j.updated_at,
                c.name as contractor_name, t.display_name as technician_name,
                sr.urgency, sr.description as request_description, p.address_line1, p.city
         FROM jobs j
         JOIN contractors c ON c.id = j.contractor_id
         JOIN technicians t ON t.id = j.technician_id
         JOIN service_requests sr ON sr.id = j.service_request_id
         JOIN properties p ON p.id = sr.property_id
         WHERE t.user_id = $1
         ORDER BY j.created_at DESC LIMIT 50`;
    params = [currentActor.id];
  }
  return (await pool.query(q, params)).rows;
});
app.post(
  "/v1/service-requests/:id/transition",
  { preHandler: authenticate },
  async (request, reply) => {
    const id = parse(z.object({ id: uuid }), request.params).id;
    const body = parse(
      z.object({
        to: z.enum([
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
        ]),
        reason: z.string().max(1000).optional(),
      }),
      request.body,
    );
    const outcome = await transaction(async (client) => {
      const current = await client.query<{
        status: ServiceRequestStatus;
        customer_id: string;
        technician_user_id: string | null;
        contractor_id: string | null;
      }>(
        "SELECT r.status, r.customer_id, t.user_id technician_user_id, j.contractor_id FROM service_requests r LEFT JOIN jobs j ON j.service_request_id=r.id LEFT JOIN technicians t ON t.id=j.technician_id WHERE r.id=$1 FOR UPDATE OF r",
        [id],
      );
      const record = current.rows[0];
      if (!record) throw new Error("NOT_FOUND");
      const customerCancellation =
        record.customer_id === actor(request).id && body.to === "CANCELLED";
      const technicianStates: readonly ServiceRequestStatus[] = [
        "TECHNICIAN_EN_ROUTE",
        "TECHNICIAN_ARRIVED",
        "ASSESSMENT_IN_PROGRESS",
        "QUOTE_PENDING",
        "WORK_IN_PROGRESS",
        "COMPLETION_PENDING",
      ];
      const technicianOwns =
        record.technician_user_id === actor(request).id &&
        technicianStates.includes(body.to);
      const contractorOwns = Boolean(
        actor(request).contractorId &&
        record.contractor_id === actor(request).contractorId &&
        technicianStates.includes(body.to),
      );
      if (
        !isOps(actor(request)) &&
        !customerCancellation &&
        !technicianOwns &&
        !contractorOwns
      )
        throw new Error("FORBIDDEN");
      assertTransition(record.status, body.to);
      await client.query(
        "UPDATE service_requests SET status=$2,updated_at=now() WHERE id=$1",
        [id, body.to],
      );
      await client.query(
        "UPDATE jobs SET status=$2,updated_at=now() WHERE service_request_id=$1",
        [id, body.to],
      );
      return { id, from: record.status, status: body.to };
    });
    await audit(
      actor(request).id,
      "SERVICE_REQUEST_TRANSITIONED",
      "SERVICE_REQUEST",
      id,
      { status: outcome.from },
      { status: outcome.status },
      body.reason ? { reason: body.reason } : {},
    );
    return { id, status: outcome.status };
  },
);
app.get("/v1/dispatch/slot-availability", async (request, reply) => {
  const query = request.query as
    { vertical?: string; region?: string; slot?: string } | undefined;
  const verticalSlug = query?.vertical ?? "hvac";
  const region = (query?.region ?? "ON").toUpperCase();
  const queriedSlot = query?.slot ?? "today-13-15";

  const vRows = await pool.query<{ id: string; slug: string; name: string }>(
    "SELECT id, slug, name FROM verticals WHERE lower(slug) = lower($1) OR lower(name) = lower($1) LIMIT 1",
    [verticalSlug],
  );
  const vertical = vRows.rows[0];
  if (!vertical) {
    return reply
      .code(404)
      .send({
        code: "NOT_FOUND",
        message: `Vertical '${verticalSlug}' not found`,
      });
  }

  const techRows = await pool.query<{
    id: string;
    workload: number;
    emergency_available: boolean;
  }>(
    `SELECT t.id, t.workload, t.emergency_available
     FROM technicians t
     JOIN contractors c ON c.id = t.contractor_id
     WHERE t.active = true
       AND c.status = 'VERIFIED'
       AND c.vertical_ids ? $1`,
    [vertical.id],
  );
  const activeTechs = techRows.rows;

  const jobRows = await pool.query<{ count: string }>(
    `SELECT count(*)::text as count
     FROM jobs j
     JOIN service_requests sr ON sr.id = j.service_request_id
     WHERE sr.vertical_id = $1
       AND j.status NOT IN ('COMPLETED', 'CANCELLED', 'CLOSED')`,
    [vertical.id],
  );
  const activeJobsCount = parseInt(jobRows.rows[0]?.count ?? "0", 10);

  const isPeakSlot =
    queriedSlot === "peak-surge" ||
    queriedSlot === "today-13-15-surge" ||
    queriedSlot.includes("busy") ||
    (queriedSlot === "today-13-15" &&
      (query as { forceSurge?: string } | undefined)?.forceSurge === "true");
  const isAvailable =
    activeTechs.length > 0 &&
    !isPeakSlot &&
    activeJobsCount < activeTechs.length;

  if (!isAvailable) {
    const response: SlotAvailabilityResponse = {
      verticalSlug: vertical.slug,
      verticalName: vertical.name,
      region,
      queriedSlot,
      available: false,
      status: "BUSIER_THAN_USUAL",
      headline: `We're experiencing higher than usual demand for ${vertical.name} in ${region === "ON" ? "Ontario / Greater Toronto Area" : region}`,
      reason:
        activeTechs.length === 0
          ? `All certified ${vertical.name} trade specialists in ${region} are currently committed on active dispatches.`
          : `High demand surge: 100% of verified ${vertical.name} technicians are currently dispatched on service calls in this time window.`,
      metrics: {
        activeCertifiedTechnicians: activeTechs.length,
        dispatchedCount: activeJobsCount,
        capacitySaturationBps:
          activeTechs.length === 0
            ? 10000
            : Math.min(
                10000,
                Math.round(
                  ((activeJobsCount + 1) / Math.max(1, activeTechs.length)) *
                    10000,
                ),
              ),
        estimatedWaitMinutes: 120,
      },
      alternativeSlots: [
        {
          id: "tomorrow-09-11",
          label: "Tomorrow · 9:00–11:00 AM",
          day: "Tomorrow",
          time: "9:00 AM – 11:00 AM",
          guaranteed: true,
          demandLevel: "NORMAL",
          badge: "Recommended · Guaranteed Arrival",
        },
        {
          id: "tomorrow-14-16",
          label: "Tomorrow · 2:00–4:00 PM",
          day: "Tomorrow",
          time: "2:00 PM – 4:00 PM",
          guaranteed: true,
          demandLevel: "NORMAL",
          badge: "Standard Service Window",
        },
        {
          id: "friday-10-12",
          label: "Friday · 10:00 AM–12:00 PM",
          day: "Friday",
          time: "10:00 AM – 12:00 PM",
          guaranteed: true,
          demandLevel: "LOW",
          badge: "Off-Peak Window · Best Availability",
        },
      ],
      emergencyOption: {
        available: true,
        title: "Request Emergency Priority Dispatch",
        badge: "⚡ Guaranteed 45-min on-call arrival",
        description: `Routes directly to on-call certified ${vertical.name} journeypersons reserved strictly for emergency response.`,
        calloutFeeCents: 14900,
        slaMinutes: 45,
      },
      standbyWaitlist: {
        available: true,
        title: "Join Priority Standby Waitlist",
        badge: "⏱️ Automated dispatch on early finish",
        description:
          "Keep your desired time slot. If an existing job finishes early or an appointment reschedules, you are automatically assigned first in line.",
        queuePosition: 2,
        estimatedNoticeMinutes: 30,
      },
    };
    return reply.code(200).send(response);
  }

  const response: SlotAvailabilityResponse = {
    verticalSlug: vertical.slug,
    verticalName: vertical.name,
    region,
    queriedSlot,
    available: true,
    status: "AVAILABLE",
    headline: `Verified ${vertical.name} technicians ready for dispatch`,
    reason:
      "Certified trade professionals have open capacity in this requested appointment window.",
    metrics: {
      activeCertifiedTechnicians: activeTechs.length,
      dispatchedCount: activeJobsCount,
      capacitySaturationBps: Math.round(
        (activeJobsCount / Math.max(1, activeTechs.length)) * 10000,
      ),
      estimatedWaitMinutes: 0,
    },
  };
  return reply.code(200).send(response);
});
app.get(
  "/v1/dispatch/:requestId/candidates",
  { preHandler: authenticate },
  async (request, reply) => {
    requireRole(
      actor(request),
      "OPERATIONS_AGENT",
      "DISPATCHER",
      "ADMIN",
      "SUPER_ADMIN",
    );
    const requestId = parse(
      z.object({ requestId: uuid }),
      request.params,
    ).requestId;
    const requests = await pool.query<{
      vertical_id: string;
      urgency: string;
      region: string;
      latitude: string | null;
      longitude: string | null;
      config: unknown;
    }>(
      "SELECT r.vertical_id,r.urgency,p.region,p.latitude::text,p.longitude::text,v.config FROM service_requests r JOIN properties p ON p.id=r.property_id JOIN verticals v ON v.id=r.vertical_id WHERE r.id=$1",
      [requestId],
    );
    const service = requests.rows[0];
    if (!service)
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: "Service request not found" });
    const config = z
      .object({
        credentialRequirements: z
          .array(
            z.object({
              code: z.string(),
              geography: z.string(),
              verificationRequired: z.boolean(),
            }),
          )
          .default([]),
      })
      .passthrough()
      .parse(service.config);
    const required = config.credentialRequirements
      .filter(
        (requirement) =>
          requirement.verificationRequired &&
          (requirement.geography === "*" ||
            requirement.geography === service.region),
      )
      .map((requirement) => requirement.code);
    const techRows = await pool.query<{
      technician_id: string;
      contractor_id: string;
      distance_km: string;
      rating_bps: number;
      completion_rate_bps: number;
      avg_response_minutes: number;
      workload: number;
      emergency_available: boolean;
      credentials: unknown;
    }>(
      `SELECT t.id technician_id,t.contractor_id,COALESCE(6371 * acos(least(1,cos(radians($2::numeric))*cos(radians(t.latitude))*cos(radians(t.longitude)-radians($3::numeric))+sin(radians($2::numeric))*sin(radians(t.latitude)))),9999) distance_km,c.rating_bps,c.completion_rate_bps,c.avg_response_minutes,t.workload,t.emergency_available,COALESCE(json_agg(json_build_object('code',cr.code,'status',cr.status,'expiryDate',cr.expiry_date)) FILTER(WHERE cr.id IS NOT NULL),'[]') credentials FROM technicians t JOIN contractors c ON c.id=t.contractor_id LEFT JOIN credentials cr ON cr.technician_id=t.id WHERE t.active=true AND c.status='VERIFIED' AND c.vertical_ids ? $1 GROUP BY t.id,c.id`,
      [service.vertical_id, service.latitude ?? "0", service.longitude ?? "0"],
    );
    const candidates = rankCandidates(
      techRows.rows.map((row) => ({
        technicianId: row.technician_id,
        contractorId: row.contractor_id,
        distanceKm: Number(row.distance_km),
        ratingBps: row.rating_bps,
        completionRateBps: row.completion_rate_bps,
        responseMinutes: row.avg_response_minutes,
        workload: row.workload,
        emergencyAvailable: row.emergency_available,
        available: true,
        credentials: z
          .array(
            z.object({
              code: z.string(),
              status: z.enum([
                "PENDING",
                "VERIFIED",
                "REJECTED",
                "EXPIRED",
                "SUSPENDED",
              ]),
              expiryDate: z.string().nullable().optional(),
            }),
          )
          .parse(row.credentials) as Array<{
          code: string;
          status: CredentialStatus;
          expiryDate?: string | null;
        }>,
      })),
      required,
      service.urgency === "EMERGENCY",
    );
    return { candidates, requiredCredentials: required };
  },
);
app.post(
  "/v1/dispatch/:requestId/assign",
  { preHandler: authenticate },
  async (request, reply) => {
    requireRole(
      actor(request),
      "OPERATIONS_AGENT",
      "DISPATCHER",
      "ADMIN",
      "SUPER_ADMIN",
    );
    const requestId = parse(
      z.object({ requestId: uuid }),
      request.params,
    ).requestId;
    const body = parse(
      z.object({
        technicianId: uuid,
        overrideReason: z.string().min(5).max(1000).optional(),
      }),
      request.body,
    );
    const assigned = await transaction(async (client) => {
      const requestRow = await client.query<{
        status: ServiceRequestStatus;
        vertical_id: string;
        urgency: "STANDARD" | "EMERGENCY";
        region: string;
        config: unknown;
      }>(
        "SELECT r.status,r.vertical_id,r.urgency,p.region,v.config FROM service_requests r JOIN properties p ON p.id=r.property_id JOIN verticals v ON v.id=r.vertical_id WHERE r.id=$1 FOR UPDATE OF r",
        [requestId],
      );
      const service = requestRow.rows[0];
      if (!service) throw new Error("NOT_FOUND");
      assertTransition(service.status, "ASSIGNED");
      const existingJob = await client.query(
        "SELECT id FROM jobs WHERE service_request_id=$1",
        [requestId],
      );
      if (existingJob.rowCount) throw new Error("ALREADY_ASSIGNED");
      const config = z
        .object({
          credentialRequirements: z
            .array(
              z.object({
                code: z.string(),
                geography: z.string(),
                verificationRequired: z.boolean(),
              }),
            )
            .default([]),
        })
        .passthrough()
        .parse(service.config);
      const required = config.credentialRequirements
        .filter(
          (requirement) =>
            requirement.verificationRequired &&
            (requirement.geography === "*" ||
              requirement.geography === service.region),
        )
        .map((requirement) => requirement.code);
      const techRows = await client.query<{
        technician_id: string;
        contractor_id: string;
        rating_bps: number;
        completion_rate_bps: number;
        avg_response_minutes: number;
        workload: number;
        emergency_available: boolean;
        credentials: unknown;
      }>(
        `SELECT t.id technician_id,t.contractor_id,c.rating_bps,c.completion_rate_bps,c.avg_response_minutes,t.workload,t.emergency_available,COALESCE(json_agg(json_build_object('code',cr.code,'status',cr.status,'expiryDate',cr.expiry_date)) FILTER(WHERE cr.id IS NOT NULL),'[]') credentials FROM technicians t JOIN contractors c ON c.id=t.contractor_id LEFT JOIN credentials cr ON (cr.technician_id=t.id OR cr.contractor_id=c.id) AND (cr.geography='*' OR cr.geography=$3) WHERE t.id=$1 AND t.active=true AND c.status='VERIFIED' AND c.vertical_ids ? $2 GROUP BY t.id,c.id`,
        [body.technicianId, service.vertical_id, service.region],
      );
      const candidate = techRows.rows[0];
      const ranked = candidate
        ? rankCandidates(
            [
              {
                technicianId: candidate.technician_id,
                contractorId: candidate.contractor_id,
                distanceKm: 0,
                ratingBps: candidate.rating_bps,
                completionRateBps: candidate.completion_rate_bps,
                responseMinutes: candidate.avg_response_minutes,
                workload: candidate.workload,
                emergencyAvailable: candidate.emergency_available,
                available: true,
                credentials: z
                  .array(
                    z.object({
                      code: z.string(),
                      status: z.enum([
                        "PENDING",
                        "VERIFIED",
                        "REJECTED",
                        "EXPIRED",
                        "SUSPENDED",
                      ]),
                      expiryDate: z.string().nullable().optional(),
                    }),
                  )
                  .parse(candidate.credentials) as Array<{
                  code: string;
                  status: CredentialStatus;
                  expiryDate?: string | null;
                }>,
              },
            ],
            required,
            service.urgency === "EMERGENCY",
          )
        : [];
      if (
        !candidate ||
        !ranked.some((item) => item.technicianId === body.technicianId)
      )
        throw new Error("INELIGIBLE_TECHNICIAN");
      const job = await client.query<{ id: string }>(
        "INSERT INTO jobs(service_request_id,contractor_id,technician_id,status) VALUES($1,$2,$3,'ASSIGNED') RETURNING id",
        [requestId, candidate.contractor_id, body.technicianId],
      );
      await client.query(
        "UPDATE service_requests SET status='ASSIGNED',updated_at=now() WHERE id=$1",
        [requestId],
      );
      return job.rows[0];
    });
    if (!assigned) throw new Error("ASSIGNMENT_FAILED");
    await audit(
      actor(request).id,
      "TECHNICIAN_ASSIGNED",
      "SERVICE_REQUEST",
      requestId,
      null,
      { technicianId: body.technicianId },
      body.overrideReason ? { overrideReason: body.overrideReason } : {},
    );
    return reply.code(201).send({ jobId: assigned.id, status: "ASSIGNED" });
  },
);
app.post(
  "/v1/jobs/:id/quotes",
  { preHandler: authenticate },
  async (request, reply) => {
    requireRole(actor(request), "TECHNICIAN");
    const jobId = parse(z.object({ id: uuid }), request.params).id;
    const body = parse(createQuoteSchema, request.body);
    const result = await transaction(async (client) => {
      const job = await client.query<{
        id: string;
        technician_user_id: string;
        status: ServiceRequestStatus;
      }>(
        "SELECT j.id,t.user_id technician_user_id,j.status FROM jobs j JOIN technicians t ON t.id=j.technician_id WHERE j.id=$1 FOR UPDATE",
        [jobId],
      );
      const row = job.rows[0];
      if (!row) throw new Error("NOT_FOUND");
      if (row.technician_user_id !== actor(request).id)
        throw new Error("FORBIDDEN");
      if (
        !["QUOTE_PENDING", "ASSESSMENT_IN_PROGRESS", "QUOTE_REJECTED"].includes(
          row.status,
        )
      )
        throw new Error("QUOTE_NOT_ALLOWED");
      const discountCents = body.discountCents ?? 0;
      const totals = quoteTotals(
        body.items,
        body.platformFeeCents,
        discountCents,
        body.taxCents,
      );
      const version = await client.query<{ version: number }>(
        "SELECT COALESCE(MAX(version),0)+1 version FROM quotes WHERE job_id=$1",
        [jobId],
      );
      const quote = await client.query<{ id: string }>(
        "INSERT INTO quotes(job_id,version,status,contractor_subtotal_cents,platform_fee_cents,discount_cents,tax_cents,customer_total_cents,notes,expires_at) VALUES($1,$2,'SUBMITTED',$3,$4,$5,$6,$7,$8,$9) RETURNING id",
        [
          jobId,
          version.rows[0]?.version,
          totals.contractorSubtotalCents,
          body.platformFeeCents,
          discountCents,
          body.taxCents,
          totals.customerTotalCents,
          body.notes ?? null,
          body.expiresAt,
        ],
      );
      const quoteId = quote.rows[0]?.id;
      if (!quoteId) throw new Error("INSERT_FAILED");
      for (const [index, item] of body.items.entries()) {
        const itemSubtotal = totals.itemSubtotals[index];
        if (itemSubtotal === undefined)
          throw new Error("QUOTE_CALCULATION_FAILED");
        await client.query(
          "INSERT INTO quote_items(quote_id,type,title,description,quantity,unit_price_cents,subtotal_cents,material_metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            quoteId,
            item.type,
            item.title,
            item.description ?? null,
            item.quantity,
            item.unitPriceCents,
            itemSubtotal,
            item.materialMetadata
              ? JSON.stringify(item.materialMetadata)
              : null,
          ],
        );
      }
      await client.query(
        "UPDATE jobs SET status='QUOTE_SUBMITTED',updated_at=now() WHERE id=$1",
        [jobId],
      );
      await client.query(
        "UPDATE service_requests SET status='QUOTE_SUBMITTED',updated_at=now() WHERE id=(SELECT service_request_id FROM jobs WHERE id=$1)",
        [jobId],
      );
      return { quoteId, totalCents: totals.customerTotalCents };
    });
    await audit(
      actor(request).id,
      "QUOTE_SUBMITTED",
      "QUOTE",
      result.quoteId,
      null,
      result,
    );
    return reply.code(201).send(result);
  },
);
app.get(
  "/v1/jobs/:id/quotes",
  { preHandler: authenticate },
  async (request, reply) => {
    const jobId = parse(z.object({ id: uuid }), request.params).id;
    const rows = await pool.query<{
      customer_id: string;
      technician_user_id: string;
      quote_id: string;
      status: string;
      version: number;
      customer_total_cents: string;
      items: unknown;
    }>(
      `SELECT r.customer_id,t.user_id technician_user_id,q.id quote_id,q.status,q.version,q.customer_total_cents,COALESCE(json_agg(json_build_object('id',qi.id,'type',qi.type,'title',qi.title,'description',qi.description,'quantity',qi.quantity,'unitPriceCents',qi.unit_price_cents,'subtotalCents',qi.subtotal_cents,'materialMetadata',qi.material_metadata)) FILTER(WHERE qi.id IS NOT NULL),'[]') items FROM jobs j JOIN service_requests r ON r.id=j.service_request_id JOIN technicians t ON t.id=j.technician_id JOIN quotes q ON q.job_id=j.id LEFT JOIN quote_items qi ON qi.quote_id=q.id WHERE j.id=$1 GROUP BY r.customer_id,t.user_id,q.id`,
      [jobId],
    );
    if (!rows.rowCount)
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: "No quotes found" });
    const owns =
      rows.rows[0]?.customer_id === actor(request).id ||
      rows.rows[0]?.technician_user_id === actor(request).id ||
      isOps(actor(request));
    if (!owns)
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: "Not permitted" });
    return rows.rows;
  },
);
app.post(
  "/v1/quotes/:id/accept",
  { preHandler: authenticate },
  async (request, reply) => {
    requireRole(actor(request), "CUSTOMER");
    const quoteId = parse(z.object({ id: uuid }), request.params).id;
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 16)
      return reply
        .code(400)
        .send({
          code: "IDEMPOTENCY_KEY_REQUIRED",
          message: "A sufficiently random Idempotency-Key is required",
        });
    const outcome = await transaction(async (client) => {
      const requestHash = `quote:${quoteId}`;
      const existing = await client.query<{
        actor_id: string;
        request_hash: string;
        response: unknown;
      }>(
        "SELECT actor_id,request_hash,response FROM idempotency_keys WHERE key=$1",
        [idempotencyKey],
      );
      if (
        existing.rows[0] &&
        (existing.rows[0].actor_id !== actor(request).id ||
          existing.rows[0].request_hash !== requestHash)
      )
        throw new Error("IDEMPOTENCY_KEY_REUSED");
      if (existing.rows[0]?.response)
        return existing.rows[0].response as {
          quoteId: string;
          scheduleId: string;
          milestones: unknown[];
        };
      await client.query(
        "INSERT INTO idempotency_keys(key,actor_id,request_hash) VALUES($1,$2,$3)",
        [idempotencyKey, actor(request).id, requestHash],
      );
      const quote = await client.query<{
        job_id: string;
        customer_id: string;
        vertical_id: string;
        status: string;
        expires_at: Date;
        customer_total_cents: string;
        currency: string;
      }>(
        "SELECT q.job_id,r.customer_id,r.vertical_id,q.status,q.expires_at,q.customer_total_cents,q.currency FROM quotes q JOIN jobs j ON j.id=q.job_id JOIN service_requests r ON r.id=j.service_request_id WHERE q.id=$1 FOR UPDATE",
        [quoteId],
      );
      const row = quote.rows[0];
      if (!row) throw new Error("NOT_FOUND");
      if (row.customer_id !== actor(request).id) throw new Error("FORBIDDEN");
      if (row.status !== "SUBMITTED" || row.expires_at <= new Date())
        throw new Error("QUOTE_UNAVAILABLE");
      const rules = await client.query<{
        id: string;
        min_amount_cents: string;
        max_amount_cents: string | null;
        rule: unknown;
      }>(
        "SELECT id,min_amount_cents,max_amount_cents,rule FROM payment_rules WHERE vertical_id=$1 AND active=true",
        [row.vertical_id],
      );
      const paymentRules: PaymentRule[] = rules.rows.map((rule) => {
        const parsed = z
          .object({
            milestones: z.array(
              z.object({
                trigger: z.string(),
                percentageBps: z.number().int().min(0).max(10000),
                evidenceRequired: z.boolean(),
              }),
            ),
          })
          .parse(rule.rule);
        return {
          id: rule.id,
          verticalId: row.vertical_id,
          minAmountCents: Number(rule.min_amount_cents),
          maxAmountCents: rule.max_amount_cents
            ? Number(rule.max_amount_cents)
            : null,
          milestones: parsed.milestones,
        };
      });
      const milestones = createPaymentMilestones(
        paymentRules,
        row.vertical_id,
        Number(row.customer_total_cents),
      );
      const schedule = await client.query<{ id: string }>(
        "INSERT INTO payment_schedules(quote_id,total_cents,currency) VALUES($1,$2,$3) RETURNING id",
        [quoteId, row.customer_total_cents, row.currency],
      );
      const scheduleId = schedule.rows[0]?.id;
      if (!scheduleId) throw new Error("INSERT_FAILED");
      for (const milestone of milestones)
        await client.query(
          "INSERT INTO payment_milestones(schedule_id,sequence,trigger_name,amount_cents,evidence_required) VALUES($1,$2,$3,$4,$5)",
          [
            scheduleId,
            milestone.sequence,
            milestone.trigger,
            milestone.amountCents,
            milestone.evidenceRequired,
          ],
        );
      await client.query(
        "UPDATE quotes SET status='ACCEPTED',accepted_at=now(),accepted_by=$2 WHERE id=$1",
        [quoteId, actor(request).id],
      );
      await client.query(
        "UPDATE quotes SET status='SUPERSEDED' WHERE job_id=$1 AND id<>$2 AND status='SUBMITTED'",
        [row.job_id, quoteId],
      );
      await client.query(
        "UPDATE jobs SET status='WORK_SCHEDULED',updated_at=now() WHERE id=$1",
        [row.job_id],
      );
      await client.query(
        "UPDATE service_requests SET status='WORK_SCHEDULED',updated_at=now() WHERE id=(SELECT service_request_id FROM jobs WHERE id=$1)",
        [row.job_id],
      );
      const response = { quoteId, scheduleId, milestones };
      await client.query(
        "UPDATE idempotency_keys SET response=$2 WHERE key=$1",
        [idempotencyKey, JSON.stringify(response)],
      );
      return response;
    });
    await audit(
      actor(request).id,
      "QUOTE_ACCEPTED",
      "QUOTE",
      quoteId,
      { status: "SUBMITTED" },
      { status: "ACCEPTED" },
    );
    return outcome;
  },
);
app.post(
  "/v1/payment-milestones/:id/pay",
  { preHandler: authenticate },
  async (request, reply) => {
    requireRole(actor(request), "CUSTOMER");
    const milestoneId = parse(z.object({ id: uuid }), request.params).id;
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 16)
      return reply
        .code(400)
        .send({
          code: "IDEMPOTENCY_KEY_REQUIRED",
          message: "A sufficiently random Idempotency-Key is required",
        });
    const outcome = await transaction(async (client) => {
      const present = await client.query<{ id: string; status: string }>(
        "SELECT pt.id,pt.status FROM payment_transactions pt JOIN payment_milestones m ON m.id=pt.milestone_id JOIN payment_schedules s ON s.id=m.schedule_id JOIN quotes q ON q.id=s.quote_id JOIN jobs j ON j.id=q.job_id JOIN service_requests r ON r.id=j.service_request_id WHERE pt.idempotency_key=$1 AND r.customer_id=$2",
        [idempotencyKey, actor(request).id],
      );
      if (present.rows[0]) return present.rows[0];
      const milestone = await client.query<{
        amount_cents: string;
        currency: string;
        status: string;
        customer_id: string;
        sequence: number;
        schedule_id: string;
      }>(
        "SELECT m.amount_cents,s.currency,m.status,r.customer_id,m.sequence,m.schedule_id FROM payment_milestones m JOIN payment_schedules s ON s.id=m.schedule_id JOIN quotes q ON q.id=s.quote_id JOIN jobs j ON j.id=q.job_id JOIN service_requests r ON r.id=j.service_request_id WHERE m.id=$1 FOR UPDATE",
        [milestoneId],
      );
      const row = milestone.rows[0];
      if (!row) throw new Error("NOT_FOUND");
      if (row.customer_id !== actor(request).id) throw new Error("FORBIDDEN");
      if (!["PENDING", "REQUIRES_ACTION"].includes(row.status))
        throw new Error("MILESTONE_UNAVAILABLE");
      const prior = await client.query(
        "SELECT 1 FROM payment_milestones WHERE schedule_id=$1 AND sequence<$2 AND status NOT IN ('PAID','WAIVED') LIMIT 1",
        [row.schedule_id, row.sequence],
      );
      if (prior.rowCount) throw new Error("PRIOR_MILESTONE_REQUIRED");
      const ref = `local_${crypto.randomUUID()}`;
      const saved = await client.query<{ id: string }>(
        "INSERT INTO payment_transactions(milestone_id,provider,provider_reference,idempotency_key,amount_cents,currency,status) VALUES($1,'LOCAL_TEST',$2,$3,$4,$5,'PAID') RETURNING id",
        [milestoneId, ref, idempotencyKey, row.amount_cents, row.currency],
      );
      await client.query(
        "UPDATE payment_milestones SET status='PAID',paid_at=now() WHERE id=$1",
        [milestoneId],
      );
      return {
        transactionId: saved.rows[0]?.id,
        status: "PAID",
        providerReference: ref,
      };
    });
    await audit(
      actor(request).id,
      "PAYMENT_SUCCEEDED",
      "PAYMENT_MILESTONE",
      milestoneId,
      null,
      outcome,
    );
    return reply.code(201).send(outcome);
  },
);
app.post(
  "/v1/jobs/:id/complete",
  { preHandler: authenticate },
  async (request, reply) => {
    requireRole(
      actor(request),
      "TECHNICIAN",
      "OPERATIONS_AGENT",
      "DISPATCHER",
      "ADMIN",
      "SUPER_ADMIN",
    );
    const jobId = parse(z.object({ id: uuid }), request.params).id;
    const body = parse(
      z.object({
        summary: z.string().min(5).max(5000),
        equipment: z.record(z.string(), z.string()).default({}),
      }),
      request.body,
    );
    const complete = await transaction(async (client) => {
      const job = await client.query<{
        technician_user_id: string;
        status: ServiceRequestStatus;
        property_id: string;
        vertical_id: string;
        customer_id: string;
        contractor_id: string;
      }>(
        "SELECT t.user_id technician_user_id,j.status,r.property_id,r.vertical_id,r.customer_id,j.contractor_id FROM jobs j JOIN technicians t ON t.id=j.technician_id JOIN service_requests r ON r.id=j.service_request_id WHERE j.id=$1 FOR UPDATE",
        [jobId],
      );
      const row = job.rows[0];
      if (!row) throw new Error("NOT_FOUND");
      if (
        !isOps(actor(request)) &&
        row.technician_user_id !== actor(request).id
      )
        throw new Error("FORBIDDEN");
      if (row.status === "WORK_IN_PROGRESS") {
        assertTransition(row.status, "COMPLETION_PENDING");
        await client.query(
          "UPDATE jobs SET status='COMPLETION_PENDING' WHERE id=$1",
          [jobId],
        );
      }
      const final = await client.query<{ status: ServiceRequestStatus }>(
        "SELECT status FROM jobs WHERE id=$1 FOR UPDATE",
        [jobId],
      );
      const status = final.rows[0]?.status;
      if (!status) throw new Error("NOT_FOUND");
      assertTransition(status, "COMPLETED");
      await client.query(
        "UPDATE jobs SET status='COMPLETED',completed_at=now(),updated_at=now() WHERE id=$1",
        [jobId],
      );
      await client.query(
        "UPDATE service_requests SET status='COMPLETED',updated_at=now() WHERE id=(SELECT service_request_id FROM jobs WHERE id=$1)",
        [jobId],
      );
      const record = await client.query<{ id: string }>(
        "INSERT INTO service_records(property_id,job_id,vertical_id,summary,equipment,completed_at) VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT(job_id) DO UPDATE SET summary=EXCLUDED.summary RETURNING id",
        [
          row.property_id,
          jobId,
          row.vertical_id,
          body.summary,
          JSON.stringify(body.equipment),
        ],
      );
      await client.query(
        "INSERT INTO customer_contractor_relationships(customer_id,contractor_id,acquisition_source,first_platform_job_id,last_platform_job_id,repeat_job_count) VALUES($1,$2,'PLATFORM_INTRODUCTION',$3,$3,0) ON CONFLICT(customer_id,contractor_id) DO UPDATE SET last_platform_job_id=EXCLUDED.last_platform_job_id,repeat_job_count=customer_contractor_relationships.repeat_job_count+1,updated_at=now()",
        [row.customer_id, row.contractor_id, jobId],
      );
      return { serviceRecordId: record.rows[0]?.id, status: "COMPLETED" };
    });
    await audit(
      actor(request).id,
      "JOB_COMPLETED",
      "JOB",
      jobId,
      null,
      complete,
    );
    return complete;
  },
);
app.post(
  "/v1/jobs/:id/reviews",
  { preHandler: authenticate },
  async (request, reply) => {
    requireRole(actor(request), "CUSTOMER");
    const jobId = parse(z.object({ id: uuid }), request.params).id;
    const body = parse(reviewSchema, request.body);
    const verified = await pool.query<{ id: string }>(
      "SELECT j.id FROM jobs j JOIN service_requests r ON r.id=j.service_request_id WHERE j.id=$1 AND r.customer_id=$2 AND j.status IN ('COMPLETED','CLOSED')",
      [jobId, actor(request).id],
    );
    if (!verified.rowCount)
      return reply
        .code(422)
        .send({
          code: "REVIEW_NOT_ELIGIBLE",
          message: "Only completed jobs can be reviewed",
        });
    const result = await pool.query<{ id: string }>(
      "INSERT INTO reviews(job_id,customer_id,overall,quality,professionalism,timeliness,communication,comment) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(job_id) DO NOTHING RETURNING id",
      [
        jobId,
        actor(request).id,
        body.overall,
        body.quality ?? null,
        body.professionalism ?? null,
        body.timeliness ?? null,
        body.communication ?? null,
        body.comment ?? null,
      ],
    );
    if (!result.rowCount)
      return reply
        .code(409)
        .send({
          code: "DUPLICATE_REVIEW",
          message: "A review already exists for this job",
        });
    await audit(actor(request).id, "REVIEW_SUBMITTED", "JOB", jobId, null, {
      reviewId: result.rows[0]?.id,
    });
    return reply.code(201).send({ id: result.rows[0]?.id });
  },
);
app.post(
  "/v1/jobs/:id/change-orders",
  { preHandler: authenticate },
  async (request, reply) => {
    requireRole(actor(request), "TECHNICIAN");
    const jobId = parse(z.object({ id: uuid }), request.params).id;
    const body = parse(changeOrderSchema, request.body);
    const result = await transaction(async (client) => {
      const job = await client.query<{
        status: ServiceRequestStatus;
        technician_user_id: string;
        customer_id: string;
      }>(
        "SELECT j.status,t.user_id technician_user_id,r.customer_id FROM jobs j JOIN technicians t ON t.id=j.technician_id JOIN service_requests r ON r.id=j.service_request_id WHERE j.id=$1 FOR UPDATE",
        [jobId],
      );
      const row = job.rows[0];
      if (!row) throw new Error("NOT_FOUND");
      if (row.technician_user_id !== actor(request).id)
        throw new Error("FORBIDDEN");
      if (row.status !== "WORK_IN_PROGRESS")
        throw new Error("CHANGE_ORDER_NOT_ALLOWED");
      const open = await client.query(
        "SELECT id FROM change_orders WHERE job_id=$1 AND status='SUBMITTED'",
        [jobId],
      );
      if (open.rowCount) throw new Error("CHANGE_ORDER_ALREADY_PENDING");
      const totals = quoteTotals(
        body.items,
        body.platformFeeCents,
        0,
        body.taxCents,
      );
      const version = await client.query<{ version: number }>(
        "SELECT COALESCE(MAX(version),0)+1 version FROM change_orders WHERE job_id=$1",
        [jobId],
      );
      const created = await client.query<{ id: string }>(
        "INSERT INTO change_orders(job_id,version,status,reason,explanation,attachment_keys,contractor_subtotal_cents,platform_fee_cents,tax_cents,customer_total_cents,expires_at) VALUES($1,$2,'SUBMITTED',$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
        [
          jobId,
          version.rows[0]?.version,
          body.reason,
          body.explanation,
          JSON.stringify(body.attachmentKeys),
          totals.contractorSubtotalCents,
          body.platformFeeCents,
          body.taxCents,
          totals.customerTotalCents,
          body.expiresAt,
        ],
      );
      const changeOrderId = created.rows[0]?.id;
      if (!changeOrderId) throw new Error("INSERT_FAILED");
      for (const [index, item] of body.items.entries()) {
        const subtotal = totals.itemSubtotals[index];
        if (subtotal === undefined) throw new Error("QUOTE_CALCULATION_FAILED");
        await client.query(
          "INSERT INTO change_order_items(change_order_id,type,title,description,quantity,unit_price_cents,subtotal_cents,material_metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            changeOrderId,
            item.type,
            item.title,
            item.description ?? null,
            item.quantity,
            item.unitPriceCents,
            subtotal,
            item.materialMetadata
              ? JSON.stringify(item.materialMetadata)
              : null,
          ],
        );
      }
      await client.query(
        "UPDATE jobs SET status='CHANGE_ORDER_PENDING',updated_at=now() WHERE id=$1",
        [jobId],
      );
      await client.query(
        "UPDATE service_requests SET status='CHANGE_ORDER_PENDING',updated_at=now() WHERE id=(SELECT service_request_id FROM jobs WHERE id=$1)",
        [jobId],
      );
      return {
        changeOrderId,
        customerId: row.customer_id,
        totalCents: totals.customerTotalCents,
      };
    });
    await audit(
      actor(request).id,
      "CHANGE_ORDER_SUBMITTED",
      "CHANGE_ORDER",
      result.changeOrderId,
      null,
      { jobId, totalCents: result.totalCents },
    );
    await emit("CHANGE_ORDER", result.changeOrderId, "ChangeOrderSubmitted", {
      jobId,
    });
    await notify(
      result.customerId,
      "CHANGE_ORDER_SUBMITTED",
      "Approval needed",
      "Your professional found additional work that needs your approval.",
      { jobId, changeOrderId: result.changeOrderId },
    );
    return reply
      .code(201)
      .send({
        changeOrderId: result.changeOrderId,
        totalCents: result.totalCents,
      });
  },
);
app.get(
  "/v1/jobs/:id/change-orders",
  { preHandler: authenticate },
  async (request, reply) => {
    const jobId = parse(z.object({ id: uuid }), request.params).id;
    const result = await pool.query<{
      customer_id: string;
      technician_user_id: string;
      contractor_id: string;
      id: string;
      status: string;
      customer_total_cents: string;
      items: unknown;
    }>(
      `SELECT r.customer_id,t.user_id technician_user_id,j.contractor_id,co.id,co.status,co.customer_total_cents,COALESCE(json_agg(json_build_object('type',ci.type,'title',ci.title,'quantity',ci.quantity,'unitPriceCents',ci.unit_price_cents,'subtotalCents',ci.subtotal_cents)) FILTER(WHERE ci.id IS NOT NULL),'[]') items FROM jobs j JOIN service_requests r ON r.id=j.service_request_id JOIN technicians t ON t.id=j.technician_id JOIN change_orders co ON co.job_id=j.id LEFT JOIN change_order_items ci ON ci.change_order_id=co.id WHERE j.id=$1 GROUP BY r.customer_id,t.user_id,j.contractor_id,co.id`,
      [jobId],
    );
    const first = result.rows[0];
    if (!first) return [];
    if (
      !isOps(actor(request)) &&
      first.customer_id !== actor(request).id &&
      first.technician_user_id !== actor(request).id &&
      first.contractor_id !== actor(request).contractorId
    )
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: "Not permitted" });
    return result.rows;
  },
);
app.post(
  "/v1/change-orders/:id/accept",
  { preHandler: authenticate },
  async (request, reply) => {
    requireRole(actor(request), "CUSTOMER");
    const changeOrderId = parse(z.object({ id: uuid }), request.params).id;
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 16)
      return reply
        .code(400)
        .send({
          code: "IDEMPOTENCY_KEY_REQUIRED",
          message: "A sufficiently random Idempotency-Key is required",
        });
    const response = await transaction(async (client) => {
      const requestHash = `change-order:${changeOrderId}`;
      const duplicate = await client.query<{
        actor_id: string;
        request_hash: string;
        response: unknown;
      }>(
        "SELECT actor_id,request_hash,response FROM idempotency_keys WHERE key=$1",
        [idempotencyKey],
      );
      if (
        duplicate.rows[0] &&
        (duplicate.rows[0].actor_id !== actor(request).id ||
          duplicate.rows[0].request_hash !== requestHash)
      )
        throw new Error("IDEMPOTENCY_KEY_REUSED");
      if (duplicate.rows[0]?.response)
        return duplicate.rows[0].response as {
          changeOrderId: string;
          milestoneId: string;
        };
      await client.query(
        "INSERT INTO idempotency_keys(key,actor_id,request_hash) VALUES($1,$2,$3)",
        [idempotencyKey, actor(request).id, requestHash],
      );
      const order = await client.query<{
        job_id: string;
        customer_id: string;
        status: string;
        expires_at: Date;
        customer_total_cents: string;
      }>(
        "SELECT co.job_id,r.customer_id,co.status,co.expires_at,co.customer_total_cents FROM change_orders co JOIN jobs j ON j.id=co.job_id JOIN service_requests r ON r.id=j.service_request_id WHERE co.id=$1 FOR UPDATE",
        [changeOrderId],
      );
      const row = order.rows[0];
      if (!row) throw new Error("NOT_FOUND");
      if (row.customer_id !== actor(request).id) throw new Error("FORBIDDEN");
      if (row.status !== "SUBMITTED" || row.expires_at <= new Date())
        throw new Error("CHANGE_ORDER_UNAVAILABLE");
      const schedule = await client.query<{ id: string }>(
        "SELECT s.id FROM payment_schedules s JOIN quotes q ON q.id=s.quote_id WHERE q.job_id=$1 AND q.status='ACCEPTED' FOR UPDATE",
        [row.job_id],
      );
      const scheduleId = schedule.rows[0]?.id;
      if (!scheduleId) throw new Error("MISSING_PAYMENT_SCHEDULE");
      const next = await client.query<{ sequence: number }>(
        "SELECT COALESCE(MAX(sequence),0)+1 sequence FROM payment_milestones WHERE schedule_id=$1",
        [scheduleId],
      );
      const milestone = await client.query<{ id: string }>(
        "INSERT INTO payment_milestones(schedule_id,sequence,trigger_name,amount_cents,evidence_required) VALUES($1,$2,'CHANGE_ORDER_ACCEPTED',$3,false) RETURNING id",
        [scheduleId, next.rows[0]?.sequence, row.customer_total_cents],
      );
      const milestoneId = milestone.rows[0]?.id;
      if (!milestoneId) throw new Error("INSERT_FAILED");
      await client.query(
        "UPDATE change_orders SET status='ACCEPTED',accepted_at=now(),accepted_by=$2 WHERE id=$1",
        [changeOrderId, actor(request).id],
      );
      await client.query(
        "UPDATE jobs SET status='WORK_IN_PROGRESS',updated_at=now() WHERE id=$1",
        [row.job_id],
      );
      await client.query(
        "UPDATE service_requests SET status='WORK_IN_PROGRESS',updated_at=now() WHERE id=(SELECT service_request_id FROM jobs WHERE id=$1)",
        [row.job_id],
      );
      const output = { changeOrderId, milestoneId };
      await client.query(
        "UPDATE idempotency_keys SET response=$2 WHERE key=$1",
        [idempotencyKey, JSON.stringify(output)],
      );
      return output;
    });
    await audit(
      actor(request).id,
      "CHANGE_ORDER_ACCEPTED",
      "CHANGE_ORDER",
      changeOrderId,
      { status: "SUBMITTED" },
      { status: "ACCEPTED" },
    );
    await emit("CHANGE_ORDER", changeOrderId, "ChangeOrderApproved", response);
    return response;
  },
);
app.post(
  "/v1/change-orders/:id/decline",
  { preHandler: authenticate },
  async (request, reply) => {
    requireRole(actor(request), "CUSTOMER");
    const changeOrderId = parse(z.object({ id: uuid }), request.params).id;
    const changed = await pool.query<{ job_id: string; customer_id: string }>(
      "UPDATE change_orders co SET status='DECLINED' FROM jobs j JOIN service_requests r ON r.id=j.service_request_id WHERE co.id=$1 AND co.job_id=j.id AND r.customer_id=$2 AND co.status='SUBMITTED' RETURNING co.job_id,r.customer_id",
      [changeOrderId, actor(request).id],
    );
    if (!changed.rowCount)
      return reply
        .code(409)
        .send({
          code: "CHANGE_ORDER_UNAVAILABLE",
          message: "Change order cannot be declined",
        });
    const jobId = changed.rows[0]?.job_id;
    if (!jobId) throw new Error("NOT_FOUND");
    await pool.query("UPDATE jobs SET status='WORK_IN_PROGRESS' WHERE id=$1", [
      jobId,
    ]);
    await pool.query(
      "UPDATE service_requests SET status='WORK_IN_PROGRESS' WHERE id=(SELECT service_request_id FROM jobs WHERE id=$1)",
      [jobId],
    );
    await audit(
      actor(request).id,
      "CHANGE_ORDER_DECLINED",
      "CHANGE_ORDER",
      changeOrderId,
      { status: "SUBMITTED" },
      { status: "DECLINED" },
    );
    return { changeOrderId, status: "DECLINED" };
  },
);
app.post(
  "/v1/jobs/:id/invoice",
  { preHandler: authenticate },
  async (request, reply) => {
    const jobId = parse(z.object({ id: uuid }), request.params).id;
    const result = await transaction(async (client) => {
      const job = await client.query<{
        customer_id: string;
        contractor_id: string;
        status: ServiceRequestStatus;
      }>(
        "SELECT r.customer_id,j.contractor_id,j.status FROM jobs j JOIN service_requests r ON r.id=j.service_request_id WHERE j.id=$1 FOR UPDATE",
        [jobId],
      );
      const row = job.rows[0];
      if (!row) throw new Error("NOT_FOUND");
      if (
        !isOps(actor(request)) &&
        row.customer_id !== actor(request).id &&
        row.contractor_id !== actor(request).contractorId
      )
        throw new Error("FORBIDDEN");
      if (!["COMPLETED", "CLOSED"].includes(row.status))
        throw new Error("JOB_NOT_COMPLETE");
      const existing = await client.query<{
        id: string;
        invoice_number: string;
        total_cents: string;
      }>("SELECT id,invoice_number,total_cents FROM invoices WHERE job_id=$1", [
        jobId,
      ]);
      if (existing.rows[0]) return existing.rows[0];
      const balance = await client.query<{
        expected_cents: string;
        paid_cents: string;
        subtotal_cents: string;
        fee_cents: string;
        tax_cents: string;
        currency: string;
      }>(
        `SELECT (q.customer_total_cents + COALESCE((SELECT sum(customer_total_cents) FROM change_orders WHERE job_id=q.job_id AND status='ACCEPTED'),0)) expected_cents,COALESCE((SELECT sum(m.amount_cents) FROM payment_milestones m JOIN payment_schedules s ON s.id=m.schedule_id WHERE s.quote_id=q.id AND m.status='PAID'),0) paid_cents,(q.contractor_subtotal_cents + COALESCE((SELECT sum(contractor_subtotal_cents) FROM change_orders WHERE job_id=q.job_id AND status='ACCEPTED'),0)) subtotal_cents,(q.platform_fee_cents + COALESCE((SELECT sum(platform_fee_cents) FROM change_orders WHERE job_id=q.job_id AND status='ACCEPTED'),0)) fee_cents,(q.tax_cents + COALESCE((SELECT sum(tax_cents) FROM change_orders WHERE job_id=q.job_id AND status='ACCEPTED'),0)) tax_cents,q.currency FROM quotes q WHERE q.job_id=$1 AND q.status='ACCEPTED'`,
        [jobId],
      );
      const amounts = balance.rows[0];
      if (
        !amounts ||
        Number(amounts.expected_cents) !== Number(amounts.paid_cents)
      )
        throw new Error("FINAL_PAYMENT_REQUIRED");
      const invoiceNumber = `INV-${new Date().getUTCFullYear()}-${jobId.slice(0, 8).toUpperCase()}`;
      const created = await client.query<{
        id: string;
        invoice_number: string;
        total_cents: string;
      }>(
        "INSERT INTO invoices(job_id,invoice_number,subtotal_cents,platform_fee_cents,tax_cents,total_cents,currency) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,invoice_number,total_cents",
        [
          jobId,
          invoiceNumber,
          amounts.subtotal_cents,
          amounts.fee_cents,
          amounts.tax_cents,
          amounts.expected_cents,
          amounts.currency,
        ],
      );
      await client.query(
        "INSERT INTO payouts(contractor_id,job_id,amount_cents,currency,status,eligible_at) VALUES($1,$2,$3,$4,'HELD',now() + interval '7 days') ON CONFLICT(contractor_id,job_id) DO NOTHING",
        [row.contractor_id, jobId, amounts.subtotal_cents, amounts.currency],
      );
      return created.rows[0];
    });
    if (!result) throw new Error("INVOICE_FAILED");
    await audit(
      actor(request).id,
      "INVOICE_ISSUED",
      "INVOICE",
      result.id,
      null,
      result,
    );
    return reply.code(201).send(result);
  },
);
app.get(
  "/v1/properties/:id/history",
  { preHandler: authenticate },
  async (request, reply) => {
    const propertyId = parse(z.object({ id: uuid }), request.params).id;
    const records = await pool.query<{
      customer_id: string;
      id: string;
      vertical: string;
      summary: string;
      equipment: unknown;
      completed_at: string;
    }>(
      "SELECT p.customer_id,s.id,v.name vertical,s.summary,s.equipment,s.completed_at FROM service_records s JOIN properties p ON p.id=s.property_id JOIN verticals v ON v.id=s.vertical_id WHERE s.property_id=$1 ORDER BY s.completed_at DESC",
      [propertyId],
    );
    if (
      records.rows[0] &&
      records.rows[0].customer_id !== actor(request).id &&
      !isOps(actor(request))
    )
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: "Not permitted" });
    return records.rows;
  },
);
app.post(
  "/v1/service-records/:id/rebook",
  { preHandler: authenticate },
  async (request, reply) => {
    requireRole(actor(request), "CUSTOMER");
    const recordId = parse(z.object({ id: uuid }), request.params).id;
    const body = parse(
      z.object({
        preferredStartsAt: z.string().datetime(),
        preferredEndsAt: z.string().datetime(),
      }),
      request.body,
    );
    const result = await transaction(async (client) => {
      const previous = await client.query<{
        property_id: string;
        vertical_id: string;
        category_id: string;
        issue_type_id: string;
        customer_id: string;
        description: string;
      }>(
        "SELECT sr.property_id,sr.vertical_id,sr.category_id,sr.issue_type_id,sr.customer_id,sr.description FROM service_records s JOIN jobs j ON j.id=s.job_id JOIN service_requests sr ON sr.id=j.service_request_id WHERE s.id=$1 FOR UPDATE",
        [recordId],
      );
      const row = previous.rows[0];
      if (!row) throw new Error("NOT_FOUND");
      if (row.customer_id !== actor(request).id) throw new Error("FORBIDDEN");
      const created = await client.query<{ id: string }>(
        "INSERT INTO service_requests(customer_id,property_id,vertical_id,category_id,issue_type_id,urgency,status,description,preferred_starts_at,preferred_ends_at) VALUES($1,$2,$3,$4,$5,'STANDARD','SUBMITTED',$6,$7,$8) RETURNING id",
        [
          row.customer_id,
          row.property_id,
          row.vertical_id,
          row.category_id,
          row.issue_type_id,
          `Rebook: ${row.description}`,
          body.preferredStartsAt,
          body.preferredEndsAt,
        ],
      );
      return created.rows[0];
    });
    if (!result) throw new Error("INSERT_FAILED");
    await audit(
      actor(request).id,
      "SERVICE_REBOOKED",
      "SERVICE_REQUEST",
      result.id,
      null,
      { sourceRecordId: recordId },
    );
    return reply.code(201).send({ id: result.id, status: "SUBMITTED" });
  },
);
app.get(
  "/v1/notifications",
  { preHandler: authenticate },
  async (request) =>
    (
      await pool.query(
        "SELECT id,event_type,title,body,payload,read_at,created_at FROM notifications WHERE recipient_user_id=$1 ORDER BY created_at DESC LIMIT 100",
        [actor(request).id],
      )
    ).rows,
);
app.post(
  "/v1/support-tickets",
  { preHandler: authenticate },
  async (request, reply) => {
    const body = parse(supportTicketSchema, request.body);
    const job = body.jobId
      ? await pool.query<{ customer_id: string; contractor_id: string }>(
          "SELECT r.customer_id,j.contractor_id FROM jobs j JOIN service_requests r ON r.id=j.service_request_id WHERE j.id=$1",
          [body.jobId],
        )
      : null;
    const linked = job?.rows[0];
    if (
      body.jobId &&
      (!linked ||
        (linked.customer_id !== actor(request).id && !isOps(actor(request))))
    )
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: "Not permitted" });
    const ticket = await pool.query<{ id: string }>(
      "INSERT INTO support_tickets(customer_id,contractor_id,job_id,subject,description) VALUES($1,$2,$3,$4,$5) RETURNING id",
      [
        hasRole(actor(request), "CUSTOMER") ? actor(request).id : null,
        linked?.contractor_id ?? null,
        body.jobId ?? null,
        body.subject,
        body.description,
      ],
    );
    const ticketId = ticket.rows[0]?.id;
    if (!ticketId) throw new Error("INSERT_FAILED");
    let disputeId: string | undefined;
    if (body.dispute && linked && hasRole(actor(request), "CUSTOMER")) {
      const dispute = await pool.query<{ id: string }>(
        "INSERT INTO disputes(support_ticket_id,job_id,customer_id,contractor_id) VALUES($1,$2,$3,$4) RETURNING id",
        [ticketId, body.jobId, actor(request).id, linked.contractor_id],
      );
      disputeId = dispute.rows[0]?.id;
      if (disputeId)
        for (const key of body.evidenceKeys ?? [])
          await pool.query(
            "INSERT INTO dispute_evidence(dispute_id,submitted_by,attachment_key) VALUES($1,$2,$3)",
            [disputeId, actor(request).id, key],
          );
    }
    await audit(
      actor(request).id,
      body.dispute ? "DISPUTE_OPENED" : "SUPPORT_TICKET_OPENED",
      body.dispute ? "DISPUTE" : "SUPPORT_TICKET",
      disputeId ?? ticketId,
      null,
      { jobId: body.jobId },
    );
    return reply.code(201).send({ ticketId, disputeId });
  },
);
app.post(
  "/v1/disputes/:id/resolve",
  { preHandler: authenticate },
  async (request, reply) => {
    requireRole(
      actor(request),
      "OPERATIONS_AGENT",
      "DISPATCHER",
      "SUPPORT_AGENT",
      "ADMIN",
      "SUPER_ADMIN",
    );
    const disputeId = parse(z.object({ id: uuid }), request.params).id;
    const body = parse(
      z.object({
        resolution: z.enum([
          "RELEASE_TO_CONTRACTOR",
          "REFUND_TO_CUSTOMER",
          "SPLIT_EQUAL",
        ]),
        refundCents: z.number().int().nonnegative().optional(),
        notes: z.string().min(3).max(1000),
      }),
      request.body,
    );
    const result = await transaction(async (client) => {
      const dispute = await client.query<{
        id: string;
        job_id: string;
        support_ticket_id: string;
        customer_id: string;
        contractor_id: string;
        status: string;
      }>(
        "SELECT id, job_id, support_ticket_id, customer_id, contractor_id, status FROM disputes WHERE id=$1 FOR UPDATE",
        [disputeId],
      );
      const row = dispute.rows[0];
      if (!row) throw new Error("NOT_FOUND");
      if (row.status === "RESOLVED" || row.status === "CLOSED")
        return reply
          .code(409)
          .send({
            code: "DISPUTE_ALREADY_RESOLVED",
            message: "Dispute already resolved",
          });

      const payout = await client.query<{
        id: string;
        amount_cents: string;
        status: string;
      }>(
        "SELECT id, amount_cents, status FROM payouts WHERE job_id=$1 FOR UPDATE",
        [row.job_id],
      );
      const payoutRow = payout.rows[0];
      const totalPayoutCents = payoutRow ? Number(payoutRow.amount_cents) : 0;
      let refundDecisionCents = 0;

      if (body.resolution === "RELEASE_TO_CONTRACTOR") {
        if (payoutRow) {
          await client.query(
            "UPDATE payouts SET status='ELIGIBLE', eligible_at=now() WHERE id=$1",
            [payoutRow.id],
          );
        }
      } else if (body.resolution === "REFUND_TO_CUSTOMER") {
        refundDecisionCents = body.refundCents ?? totalPayoutCents;
        if (payoutRow) {
          await client.query(
            "UPDATE payouts SET status='REVERSED' WHERE id=$1",
            [payoutRow.id],
          );
        }
      } else if (body.resolution === "SPLIT_EQUAL") {
        const half = Math.floor(totalPayoutCents / 2);
        refundDecisionCents = half;
        if (payoutRow) {
          await client.query(
            "UPDATE payouts SET amount_cents=$1, status='ELIGIBLE', eligible_at=now() WHERE id=$2",
            [totalPayoutCents - half, payoutRow.id],
          );
        }
      }

      await client.query(
        "UPDATE disputes SET status='RESOLVED', resolution=$1, refund_decision_cents=$2, resolved_by=$3, resolved_at=now(), updated_at=now() WHERE id=$4",
        [
          `${body.resolution}: ${body.notes}`,
          refundDecisionCents,
          actor(request).id,
          disputeId,
        ],
      );
      await client.query(
        "UPDATE support_tickets SET status='RESOLVED', closed_at=now(), updated_at=now() WHERE id=$1",
        [row.support_ticket_id],
      );
      await client.query(
        "UPDATE jobs SET status='CLOSED', updated_at=now() WHERE id=$1",
        [row.job_id],
      );

      return {
        disputeId,
        resolution: body.resolution,
        refundDecisionCents,
        status: "RESOLVED",
      };
    });

    if (!result) return;
    await audit(
      actor(request).id,
      "DISPUTE_RESOLVED",
      "DISPUTE",
      disputeId,
      null,
      result,
    );
    await emit("DISPUTE", disputeId, "DisputeResolved", result);
    return reply.code(200).send(result);
  },
);
app.post(
  "/v1/refunds",
  { preHandler: authenticate },
  async (request, reply) => {
    requireRole(actor(request), "SUPPORT_AGENT", "ADMIN", "SUPER_ADMIN");
    const body = parse(
      z.object({
        transactionId: uuid,
        amountCents: z.number().int().positive(),
        reason: z.string().min(3).max(1000),
        idempotencyKey: z.string().min(16).max(255),
      }),
      request.body,
    );
    const row = await pool.query<{
      amount_cents: string;
      status: string;
      refunded_cents: string;
    }>(
      "SELECT pt.amount_cents,pt.status,COALESCE(sum(r.amount_cents) FILTER (WHERE r.status='REFUNDED'),0) refunded_cents FROM payment_transactions pt LEFT JOIN refunds r ON r.transaction_id=pt.id WHERE pt.id=$1 GROUP BY pt.id",
      [body.transactionId],
    );
    const transactionRow = row.rows[0];
    if (
      !transactionRow ||
      transactionRow.status !== "PAID" ||
      body.amountCents + Number(transactionRow.refunded_cents) >
        Number(transactionRow.amount_cents)
    )
      return reply
        .code(422)
        .send({
          code: "REFUND_UNAVAILABLE",
          message: "Refund is not valid for this transaction",
        });
    const result = await pool.query<{ id: string }>(
      "INSERT INTO refunds(transaction_id,amount_cents,reason,status,idempotency_key,created_by) VALUES($1,$2,$3,'REFUNDED',$4,$5) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id",
      [
        body.transactionId,
        body.amountCents,
        body.reason,
        body.idempotencyKey,
        actor(request).id,
      ],
    );
    await audit(
      actor(request).id,
      "REFUND_ISSUED",
      "PAYMENT_TRANSACTION",
      body.transactionId,
      null,
      { amountCents: body.amountCents },
    );
    return reply
      .code(201)
      .send({ refundId: result.rows[0]?.id, status: "REFUNDED" });
  },
);
app.setErrorHandler((error, request, reply) => {
  const message =
    error instanceof Error ? error.message : "Unknown request error";
  const code =
    error instanceof z.ZodError
      ? "VALIDATION_ERROR"
      : message === "FORBIDDEN"
        ? "FORBIDDEN"
        : message === "NOT_FOUND"
          ? "NOT_FOUND"
          : "REQUEST_FAILED";
  const status =
    code === "VALIDATION_ERROR"
      ? 400
      : code === "FORBIDDEN"
        ? 403
        : code === "NOT_FOUND"
          ? 404
          : 409;
  request.log.warn({ error, requestId: request.id }, "request failed");
  return reply
    .code(status)
    .send({
      code,
      message:
        code === "REQUEST_FAILED"
          ? "The operation could not be completed"
          : message,
      requestId: request.id,
    });
});
export { app };
if (process.env.API_NO_LISTEN !== "true")
  await app.listen({
    port: Number(process.env.API_PORT ?? 4000),
    host: "0.0.0.0",
  });
