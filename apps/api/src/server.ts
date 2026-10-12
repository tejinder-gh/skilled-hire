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
import {
  db,
  eq,
  and,
  or,
  inArray,
  isNull,
  isNotNull,
  desc,
  asc,
  sql,
  users,
  userRoles,
  verticals,
  serviceCategories,
  issueTypes,
  properties,
  contractors,
  technicians,
  credentials,
  availabilityBlocks,
  serviceRequests,
  jobs,
  quotes,
  quoteItems,
  paymentRules,
  paymentSchedules,
  paymentMilestones,
  paymentTransactions,
  serviceRecords,
  reviews,
  auditEvents,
  idempotencyKeys,
  changeOrders,
  changeOrderItems,
  invoices,
  supportTickets,
  disputes,
  disputeEvidence,
  notifications,
  domainEvents,
  customerContractorRelationships,
  payouts,
  refunds,
  tradeRegulatoryPolicies,
  credentialGroups,
  complianceStandards,
  complianceEvaluations,
} from "@marketplace/database";
import {
  CANONICAL_TRADE_CATALOG,
  CREDENTIAL_GROUPS,
  DEFAULT_COMPLIANCE_STANDARDS,
  evaluateCompliance,
  evaluateRegulatoryEligibility,
  filterComplianceStandards,
  resolveRegulatoryPolicy,
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
} from "@marketplace/validation";

const app = Fastify({ logger: true });
const jwtSecret =
  process.env.JWT_SECRET ?? "dev_only_jwt_secret_must_be_32_characters_minimum";
await app.register(jwt, { secret: jwtSecret });
await app.register(helmet, {
  contentSecurityPolicy: process.env.NODE_ENV === "production",
});
await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (
      origin.includes("localhost") ||
      origin.includes("127.0.0.1") ||
      origin.endsWith(".skilledhire.ca") ||
      origin === "https://skilledhire.ca"
    )
      return cb(null, true);
    cb(new Error("CORS_NOT_ALLOWED"), false);
  },
  credentials: true,
});

declare module "fastify" {
  interface FastifyRequest {
    actor?: Actor;
  }
}

const uuid = z.string().uuid();
const rolesSchema = z
  .union([
    z.array(
      z.enum([
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
      ]),
    ),
    z.string().transform((v) =>
      v
        .replace(/[{}]/g, "")
        .split(",")
        .filter(Boolean),
    ),
    z.array(z.string()),
  ])
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
    const user = await db.query.users.findFirst({
      where: and(eq(users.id, payload.sub), isNull(users.deletedAt)),
      with: {
        roles: true,
      },
    });
    if (!user || user.sessionVersion !== payload.sessionVersion)
      throw new Error("SESSION_REVOKED");

    const [tech] = await db
      .select({ contractorId: technicians.contractorId })
      .from(technicians)
      .where(eq(technicians.userId, user.id))
      .limit(1);

    const [contractor] = await db
      .select({ id: contractors.id })
      .from(contractors)
      .where(eq(contractors.ownerUserId, user.id))
      .limit(1);

    const contractorId = tech?.contractorId ?? contractor?.id ?? null;

    request.actor = {
      id: user.id,
      roles: rolesSchema.parse(user.roles.map((r) => r.role)),
      ...(contractorId ? { contractorId } : {}),
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
  await db.insert(auditEvents).values({
    actorId,
    actorType: actorId ? "USER" : "SYSTEM",
    action,
    entityType,
    entityId,
    beforeState: before as any,
    afterState: after as any,
    metadata,
  });
}

async function emit(
  aggregateType: string,
  aggregateId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.insert(domainEvents).values({
    aggregateType,
    aggregateId,
    eventType,
    payload,
  });
}

async function notify(
  recipientUserId: string,
  eventType: string,
  title: string,
  body: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.insert(notifications).values({
    recipientUserId,
    eventType,
    title,
    body,
    payload,
  });
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
    const user = await db.query.users.findFirst({
      where: and(
        eq(users.email, body.email.toLowerCase()),
        isNull(users.deletedAt),
      ),
      with: {
        roles: true,
      },
    });
    if (!user || !(await verifyPassword(body.password, user.passwordHash)))
      return reply
        .code(401)
        .send({
          code: "INVALID_CREDENTIALS",
          message: "Invalid email or password",
        });
    const token = await reply.jwtSign(
      { sub: user.id, sessionVersion: user.sessionVersion },
      { expiresIn: "15m" },
    );
    return {
      accessToken: token,
      roles: rolesSchema.parse(user.roles.map((r) => r.role)),
    };
  },
);

app.get("/v1/me", { preHandler: authenticate }, async (request) => ({
  actor: actor(request),
}));

app.get(
  "/v1/verticals",
  async () =>
    await db
      .select({
        id: verticals.id,
        slug: verticals.slug,
        name: verticals.name,
        config: verticals.config,
      })
      .from(verticals)
      .where(eq(verticals.active, true))
      .orderBy(verticals.name),
);

app.get("/v1/verticals/:slug/intake", async (request, reply) => {
  const { slug } = request.params as { slug: string };
  const vertical = await db.query.verticals.findFirst({
    where: and(eq(verticals.slug, slug), eq(verticals.active, true)),
    columns: { id: true, name: true },
  });
  if (!vertical)
    return reply
      .code(404)
      .send({ code: "NOT_FOUND", message: "Vertical not found" });

  let categories = await db
    .select({
      id: serviceCategories.id,
      slug: serviceCategories.slug,
      name: serviceCategories.name,
    })
    .from(serviceCategories)
    .where(
      and(
        eq(serviceCategories.verticalId, vertical.id),
        eq(serviceCategories.active, true),
      ),
    )
    .orderBy(serviceCategories.name);

  if (categories.length === 0) {
    const [insertedCat] = await db
      .insert(serviceCategories)
      .values({
        verticalId: vertical.id,
        slug: "general-service",
        name: "General Service",
      })
      .returning({
        id: serviceCategories.id,
        slug: serviceCategories.slug,
        name: serviceCategories.name,
      });
    if (insertedCat) {
      await db.insert(issueTypes).values({
        categoryId: insertedCat.id,
        slug: "general-repair",
        name: "General Repair & Diagnostic",
      });
      categories = [insertedCat];
    }
  }

  const issues = await db
    .select({
      id: issueTypes.id,
      categoryId: issueTypes.categoryId,
      slug: issueTypes.slug,
      name: issueTypes.name,
    })
    .from(issueTypes)
    .innerJoin(
      serviceCategories,
      eq(issueTypes.categoryId, serviceCategories.id),
    )
    .where(
      and(
        eq(serviceCategories.verticalId, vertical.id),
        eq(issueTypes.active, true),
      ),
    )
    .orderBy(issueTypes.name);

  return { vertical, categories, issues };
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
      "SURFACE_FINISHES",
      "SPECIALTY",
      "OUTDOOR_SITE",
      "GENERAL",
    ])
    .default("GENERAL"),
  description: z.string().optional(),
  icon: z.string().optional(),
  riskTier: z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"]).default("LOW"),
  permitAuthority: z.string().optional(),
  launchReady: z.boolean().default(false),
  displayOrder: z.number().int().default(0),
  config: z.record(z.unknown()).default({}),
});

const updateVerticalSchema = createVerticalSchema.partial();

const createCategorySchema = z.object({
  verticalId: uuid,
  slug: z.string().min(2).max(100),
  name: z.string().min(2).max(200),
  description: z.string().optional(),
  riskTier: z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"]).default("LOW"),
  launchReady: z.boolean().default(false),
  displayOrder: z.number().int().default(0),
});

const updateCategorySchema = createCategorySchema.partial();

const createIssueTypeSchema = z.object({
  categoryId: uuid,
  slug: z.string().min(2).max(100),
  name: z.string().min(2).max(200),
  description: z.string().optional(),
  scopeSummary: z.string().optional(),
  riskTier: z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"]).default("LOW"),
  pricingType: z
    .enum([
      "HOURLY",
      "FIXED",
      "FLAT_RATE",
      "TIME_AND_MATERIALS",
      "ESTIMATE_REQUIRED",
    ])
    .default("HOURLY"),
  basePriceCents: z.number().int().min(0).default(0),
  defaultDurationMinutes: z.number().int().min(15).default(60),
  requiresPermit: z.boolean().default(false),
  permitType: z.string().optional(),
  requiredEvidence: z.array(z.string()).default([]),
  defaultWarrantyMonths: z.number().int().min(0).default(12),
  geographicRestrictions: z.array(z.string()).default(["*"]),
  tags: z.array(z.string()).default([]),
  launchReady: z.boolean().default(false),
  displayOrder: z.number().int().default(0),
  equipmentFields: z.array(z.string()).default([]),
});

const updateIssueTypeSchema = createIssueTypeSchema.partial();

const getCatalogData = async (request: FastifyRequest) => {
  const querySchema = z.object({
    family: z.enum(["MECHANICAL", "STRUCTURAL", "SURFACE_FINISHES", "SPECIALTY", "OUTDOOR_SITE"]).optional(),
    launchReadyOnly: z.coerce.boolean().optional(),
    riskTier: z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"]).optional(),
  });
  const q = querySchema.parse(request.query);

  const whereClauses = [eq(verticals.active, true)];
  if (q.family) whereClauses.push(eq(verticals.family, q.family));
  if (q.launchReadyOnly) whereClauses.push(eq(verticals.launchReady, true));
  if (q.riskTier) whereClauses.push(eq(verticals.riskTier, q.riskTier));

  const verticalsResult = await db
    .select({
      id: verticals.id,
      slug: verticals.slug,
      name: verticals.name,
      family: verticals.family,
      description: verticals.description,
      icon: verticals.icon,
      risk_tier: verticals.riskTier,
      permit_authority: verticals.permitAuthority,
      launch_ready: verticals.launchReady,
      display_order: verticals.displayOrder,
      active: verticals.active,
      config: verticals.config,
    })
    .from(verticals)
    .where(and(...whereClauses))
    .orderBy(asc(verticals.displayOrder), asc(verticals.name));

  const catWhere = [eq(serviceCategories.active, true)];
  if (q.launchReadyOnly) catWhere.push(eq(serviceCategories.launchReady, true));

  const categoriesResult = await db
    .select({
      id: serviceCategories.id,
      vertical_id: serviceCategories.verticalId,
      slug: serviceCategories.slug,
      name: serviceCategories.name,
      description: serviceCategories.description,
      risk_tier: serviceCategories.riskTier,
      launch_ready: serviceCategories.launchReady,
      display_order: serviceCategories.displayOrder,
      active: serviceCategories.active,
    })
    .from(serviceCategories)
    .where(and(...catWhere))
    .orderBy(asc(serviceCategories.displayOrder), asc(serviceCategories.name));

  const issueWhere = [eq(issueTypes.active, true)];
  if (q.launchReadyOnly) issueWhere.push(eq(issueTypes.launchReady, true));

  const variantsResult = await db
    .select({
      id: issueTypes.id,
      category_id: issueTypes.categoryId,
      slug: issueTypes.slug,
      name: issueTypes.name,
      description: issueTypes.description,
      scope_summary: issueTypes.scopeSummary,
      risk_tier: issueTypes.riskTier,
      pricing_type: issueTypes.pricingType,
      base_price_cents: issueTypes.basePriceCents,
      default_duration_minutes: issueTypes.defaultDurationMinutes,
      requires_permit: issueTypes.requiresPermit,
      permit_type: issueTypes.permitType,
      required_evidence: issueTypes.requiredEvidence,
      default_warranty_months: issueTypes.defaultWarrantyMonths,
      geographic_restrictions: issueTypes.geographicRestrictions,
      tags: issueTypes.tags,
      launch_ready: issueTypes.launchReady,
      display_order: issueTypes.displayOrder,
      active: issueTypes.active,
    })
    .from(issueTypes)
    .where(and(...issueWhere))
    .orderBy(asc(issueTypes.displayOrder), asc(issueTypes.name));

  const variantsByCat = new Map<string, typeof variantsResult>();
  for (const variant of variantsResult) {
    const list = variantsByCat.get(variant.category_id) ?? [];
    list.push(variant);
    variantsByCat.set(variant.category_id, list);
  }

  const catsByVertical = new Map<string, Array<unknown>>();
  for (const cat of categoriesResult) {
    const list = catsByVertical.get(cat.vertical_id) ?? [];
    const catVariants = variantsByCat.get(cat.id) ?? [];
    list.push({
      ...cat,
      variants: catVariants.map((v) => ({
        ...v,
        basePriceCents: Number(v.base_price_cents),
      })),
    });
    catsByVertical.set(cat.vertical_id, list);
  }

  return verticalsResult
    .map((v) => ({
      ...v,
      categories: catsByVertical.get(v.id) ?? [],
    }))
    .filter(
      (v) => !q.launchReadyOnly || (v.categories && v.categories.length > 0),
    );
};

app.get("/v1/catalog", async (request) => {
  return await getCatalogData(request);
});

app.get("/v1/catalog/tree", async (request) => {
  const result = await getCatalogData(request);
  return {
    totalVerticals: result.length,
    verticals: result,
  };
});

app.get("/v1/catalog/search", async (request) => {
  const querySchema = z.object({
    q: z.string().default(""),
    family: z.enum(["MECHANICAL", "STRUCTURAL", "SURFACE_FINISHES", "SPECIALTY", "OUTDOOR_SITE"]).optional(),
    maxRiskTier: z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"]).optional(),
    geography: z.string().default("ON"),
    launchReadyOnly: z.coerce.boolean().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  });
  const q = querySchema.parse(request.query);
  const queryTokens = q.q.toLowerCase().trim().split(/\s+/).filter(Boolean);

  const searchWhere = [
    eq(issueTypes.active, true),
    eq(serviceCategories.active, true),
    eq(verticals.active, true),
  ];
  if (q.family) searchWhere.push(eq(verticals.family, q.family));
  if (q.launchReadyOnly) {
    searchWhere.push(
      eq(issueTypes.launchReady, true),
      eq(serviceCategories.launchReady, true),
      eq(verticals.launchReady, true),
    );
  }

  const results = await db
    .select({
      vertical_id: verticals.id,
      vertical_slug: verticals.slug,
      vertical_name: verticals.name,
      vertical_family: verticals.family,
      category_id: serviceCategories.id,
      category_slug: serviceCategories.slug,
      category_name: serviceCategories.name,
      variant_id: issueTypes.id,
      variant_slug: issueTypes.slug,
      variant_name: issueTypes.name,
      description: issueTypes.description,
      scope_summary: issueTypes.scopeSummary,
      risk_tier: issueTypes.riskTier,
      pricing_type: issueTypes.pricingType,
      base_price_cents: issueTypes.basePriceCents,
      requires_permit: issueTypes.requiresPermit,
      permit_type: issueTypes.permitType,
      launch_ready: issueTypes.launchReady,
      geographic_restrictions: issueTypes.geographicRestrictions,
      tags: issueTypes.tags,
    })
    .from(issueTypes)
    .innerJoin(serviceCategories, eq(serviceCategories.id, issueTypes.categoryId))
    .innerJoin(verticals, eq(verticals.id, serviceCategories.verticalId))
    .where(and(...searchWhere))
    .orderBy(asc(verticals.displayOrder), asc(serviceCategories.displayOrder), asc(issueTypes.displayOrder));

  const riskTierRank: Record<RiskTier, number> = {
    LOW: 1,
    MODERATE: 2,
    HIGH: 3,
    CRITICAL: 4,
  };
  const maxTier = q.maxRiskTier ? riskTierRank[q.maxRiskTier] : 4;

  const scored = results
    .filter((row) => riskTierRank[row.risk_tier as RiskTier] <= maxTier)
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
    })
    .filter((item) => queryTokens.length === 0 || item.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, q.limit);

  return scored;
});

app.get("/v1/catalog/lookup", async (request) => {
  const querySchema = z.object({
    q: z.string().default(""),
    family: z.enum(["MECHANICAL", "STRUCTURAL", "SURFACE_FINISHES", "SPECIALTY", "OUTDOOR_SITE"]).optional(),
    maxRiskTier: z.enum(["LOW", "MODERATE", "HIGH", "CRITICAL"]).optional(),
    geography: z.string().default("ON"),
  });
  const q = querySchema.parse(request.query);
  return searchCatalog(CANONICAL_TRADE_CATALOG, q.q, {
    ...(q.family ? { family: q.family as any } : {}),
    ...(q.maxRiskTier ? { maxRiskTier: q.maxRiskTier } : {}),
    geography: q.geography,
  });
});

app.get("/v1/catalog/services/:slug", async (request, reply) => {
  const { slug } = request.params as { slug: string };
  const [vertical] = await db
    .select({
      id: verticals.id,
      slug: verticals.slug,
      name: verticals.name,
      family: verticals.family,
      description: verticals.description,
      icon: verticals.icon,
      risk_tier: verticals.riskTier,
      permit_authority: verticals.permitAuthority,
      launch_ready: verticals.launchReady,
      display_order: verticals.displayOrder,
      config: verticals.config,
    })
    .from(verticals)
    .where(and(eq(verticals.slug, slug), eq(verticals.active, true)))
    .limit(1);

  if (!vertical)
    return reply
      .code(404)
      .send({ code: "NOT_FOUND", message: "Service vertical not found" });

  const categories = await db
    .select({
      id: serviceCategories.id,
      slug: serviceCategories.slug,
      name: serviceCategories.name,
      description: serviceCategories.description,
      risk_tier: serviceCategories.riskTier,
      launch_ready: serviceCategories.launchReady,
      display_order: serviceCategories.displayOrder,
    })
    .from(serviceCategories)
    .where(
      and(
        eq(serviceCategories.verticalId, vertical.id),
        eq(serviceCategories.active, true),
      ),
    )
    .orderBy(asc(serviceCategories.displayOrder), asc(serviceCategories.name));

  const variants = await db
    .select({
      id: issueTypes.id,
      category_id: issueTypes.categoryId,
      slug: issueTypes.slug,
      name: issueTypes.name,
      description: issueTypes.description,
      scope_summary: issueTypes.scopeSummary,
      risk_tier: issueTypes.riskTier,
      pricing_type: issueTypes.pricingType,
      base_price_cents: issueTypes.basePriceCents,
      default_duration_minutes: issueTypes.defaultDurationMinutes,
      requires_permit: issueTypes.requiresPermit,
      permit_type: issueTypes.permitType,
      required_evidence: issueTypes.requiredEvidence,
      default_warranty_months: issueTypes.defaultWarrantyMonths,
      geographic_restrictions: issueTypes.geographicRestrictions,
      tags: issueTypes.tags,
      launch_ready: issueTypes.launchReady,
      display_order: issueTypes.displayOrder,
    })
    .from(issueTypes)
    .innerJoin(serviceCategories, eq(serviceCategories.id, issueTypes.categoryId))
    .where(
      and(
        eq(serviceCategories.verticalId, vertical.id),
        eq(issueTypes.active, true),
      ),
    )
    .orderBy(asc(issueTypes.displayOrder), asc(issueTypes.name));

  const variantsByCat = new Map<string, typeof variants>();
  for (const variant of variants) {
    const list = variantsByCat.get(variant.category_id) ?? [];
    list.push(variant);
    variantsByCat.set(variant.category_id, list);
  }

  return {
    vertical,
    categories: categories.map((cat) => ({
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
    const [result] = await db
      .insert(verticals)
      .values({
        slug: body.slug,
        name: body.name,
        family: body.family,
        description: body.description ?? null,
        icon: body.icon ?? null,
        riskTier: body.riskTier,
        permitAuthority: body.permitAuthority ?? null,
        launchReady: body.launchReady,
        displayOrder: body.displayOrder,
        config: body.config,
      })
      .returning({ id: verticals.id });

    const id = result?.id;
    if (!id) throw new Error("INSERT_FAILED");
    await audit(
      actor(request).id,
      "VERTICAL_CREATED",
      "VERTICAL",
      id,
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
    const [existing] = await db
      .select()
      .from(verticals)
      .where(eq(verticals.id, id))
      .limit(1);

    if (!existing)
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: "Vertical not found" });

    const updateValues: Partial<typeof verticals.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (body.name !== undefined) updateValues.name = body.name;
    if (body.slug !== undefined) updateValues.slug = body.slug;
    if (body.family !== undefined) updateValues.family = body.family;
    if (body.description !== undefined) updateValues.description = body.description;
    if (body.icon !== undefined) updateValues.icon = body.icon;
    if (body.riskTier !== undefined) updateValues.riskTier = body.riskTier;
    if (body.permitAuthority !== undefined) updateValues.permitAuthority = body.permitAuthority;
    if (body.launchReady !== undefined) updateValues.launchReady = body.launchReady;
    if (body.displayOrder !== undefined) updateValues.displayOrder = body.displayOrder;
    if (body.config !== undefined) updateValues.config = body.config;

    await db.update(verticals).set(updateValues).where(eq(verticals.id, id));
    await audit(
      actor(request).id,
      "VERTICAL_UPDATED",
      "VERTICAL",
      id,
      existing,
      body,
    );
    return reply.send({ id, updated: true });
  },
);

app.post(
  "/v1/admin/catalog/categories",
  { preHandler: authenticate },
  async (request, reply) => {
    requireRole(actor(request), "ADMIN", "SUPER_ADMIN");
    const body = parse(createCategorySchema, request.body);
    const [result] = await db
      .insert(serviceCategories)
      .values({
        verticalId: body.verticalId,
        slug: body.slug,
        name: body.name,
        description: body.description ?? null,
        riskTier: body.riskTier,
        launchReady: body.launchReady,
        displayOrder: body.displayOrder,
      })
      .returning({ id: serviceCategories.id });

    const id = result?.id;
    if (!id) throw new Error("INSERT_FAILED");
    await audit(
      actor(request).id,
      "SERVICE_CATEGORY_CREATED",
      "SERVICE_CATEGORY",
      id,
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
    const [existing] = await db
      .select()
      .from(serviceCategories)
      .where(eq(serviceCategories.id, id))
      .limit(1);

    if (!existing)
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: "Category not found" });

    const updateValues: Partial<typeof serviceCategories.$inferInsert> = {};
    if (body.name !== undefined) updateValues.name = body.name;
    if (body.slug !== undefined) updateValues.slug = body.slug;
    if (body.description !== undefined) updateValues.description = body.description;
    if (body.riskTier !== undefined) updateValues.riskTier = body.riskTier;
    if (body.launchReady !== undefined) updateValues.launchReady = body.launchReady;
    if (body.displayOrder !== undefined) updateValues.displayOrder = body.displayOrder;

    await db
      .update(serviceCategories)
      .set(updateValues)
      .where(eq(serviceCategories.id, id));

    await audit(
      actor(request).id,
      "SERVICE_CATEGORY_UPDATED",
      "SERVICE_CATEGORY",
      id,
      existing,
      body,
    );
    return reply.send({ id, updated: true });
  },
);

app.post(
  "/v1/admin/catalog/issue-types",
  { preHandler: authenticate },
  async (request, reply) => {
    requireRole(actor(request), "ADMIN", "SUPER_ADMIN");
    const body = parse(createIssueTypeSchema, request.body);
    const [result] = await db
      .insert(issueTypes)
      .values({
        categoryId: body.categoryId,
        slug: body.slug,
        name: body.name,
        description: body.description ?? null,
        scopeSummary: body.scopeSummary ?? null,
        riskTier: body.riskTier,
        pricingType: body.pricingType,
        basePriceCents: body.basePriceCents,
        defaultDurationMinutes: body.defaultDurationMinutes,
        requiresPermit: body.requiresPermit,
        permitType: body.permitType ?? null,
        requiredEvidence: body.requiredEvidence,
        defaultWarrantyMonths: body.defaultWarrantyMonths,
        geographicRestrictions: body.geographicRestrictions,
        tags: body.tags,
        launchReady: body.launchReady,
        displayOrder: body.displayOrder,
        equipmentFields: body.equipmentFields,
      })
      .returning({ id: issueTypes.id });

    const id = result?.id;
    if (!id) throw new Error("INSERT_FAILED");
    await audit(
      actor(request).id,
      "ISSUE_TYPE_CREATED",
      "ISSUE_TYPE",
      id,
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
    const [existing] = await db
      .select()
      .from(issueTypes)
      .where(eq(issueTypes.id, id))
      .limit(1);

    if (!existing)
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: "Issue type / variant not found" });

    const updateValues: Partial<typeof issueTypes.$inferInsert> = {};
    if (body.name !== undefined) updateValues.name = body.name;
    if (body.slug !== undefined) updateValues.slug = body.slug;
    if (body.description !== undefined) updateValues.description = body.description;
    if (body.scopeSummary !== undefined) updateValues.scopeSummary = body.scopeSummary;
    if (body.riskTier !== undefined) updateValues.riskTier = body.riskTier;
    if (body.pricingType !== undefined) updateValues.pricingType = body.pricingType;
    if (body.basePriceCents !== undefined) updateValues.basePriceCents = body.basePriceCents;
    if (body.defaultDurationMinutes !== undefined) updateValues.defaultDurationMinutes = body.defaultDurationMinutes;
    if (body.requiresPermit !== undefined) updateValues.requiresPermit = body.requiresPermit;
    if (body.permitType !== undefined) updateValues.permitType = body.permitType;
    if (body.requiredEvidence !== undefined) updateValues.requiredEvidence = body.requiredEvidence;
    if (body.defaultWarrantyMonths !== undefined) updateValues.defaultWarrantyMonths = body.defaultWarrantyMonths;
    if (body.geographicRestrictions !== undefined) updateValues.geographicRestrictions = body.geographicRestrictions;
    if (body.tags !== undefined) updateValues.tags = body.tags;
    if (body.launchReady !== undefined) updateValues.launchReady = body.launchReady;
    if (body.displayOrder !== undefined) updateValues.displayOrder = body.displayOrder;

    await db.update(issueTypes).set(updateValues).where(eq(issueTypes.id, id));
    await audit(
      actor(request).id,
      "ISSUE_TYPE_UPDATED",
      "ISSUE_TYPE",
      id,
      existing,
      body,
    );
    return reply.send({ id, updated: true });
  },
);

app.get("/v1/compliance/groups", async () => {
  try {
    const result = await db
      .select({
        code: credentialGroups.code,
        name: credentialGroups.name,
        description: credentialGroups.description,
        displayOrder: credentialGroups.displayOrder,
        icon: credentialGroups.icon,
      })
      .from(credentialGroups)
      .orderBy(asc(credentialGroups.displayOrder));

    if (result.length) {
      return result.map((r) => ({
        code: r.code,
        name: r.name,
        description: r.description,
        displayOrder: r.displayOrder,
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
    const stdWhere = [eq(complianceStandards.active, true)];
    if (q.vertical !== "*") {
      stdWhere.push(
        or(
          eq(complianceStandards.verticalSlug, "*"),
          sql`lower(${complianceStandards.verticalSlug}) = lower(${q.vertical})`,
        )!,
      );
    }
    if (q.geography !== "*") {
      stdWhere.push(
        or(
          eq(complianceStandards.geography, "*"),
          sql`upper(${complianceStandards.geography}) = upper(${q.geography})`,
        )!,
      );
    }
    if (q.entityLevel && q.entityLevel !== "EITHER") {
      stdWhere.push(
        or(
          eq(complianceStandards.entityLevel, "EITHER"),
          eq(complianceStandards.entityLevel, q.entityLevel),
        )!,
      );
    }

    const result = await db
      .select()
      .from(complianceStandards)
      .where(and(...stdWhere))
      .orderBy(
        asc(complianceStandards.groupCode),
        desc(complianceStandards.requirementLevel),
        asc(complianceStandards.name),
      );

    if (result.length) {
      return result.map((r): ComplianceStandard => ({
        id: r.id,
        groupCode: r.groupCode as any,
        credentialCode: r.credentialCode,
        name: r.name,
        description: r.description,
        verticalSlug: r.verticalSlug,
        geography: r.geography,
        entityLevel: r.entityLevel as EntityLevel,
        requirementLevel: r.requirementLevel as any,
        issuingAuthority: r.issuingAuthority,
        legalReference: r.legalReference ?? undefined,
        verificationMethod: r.verificationMethod as any,
        validityPeriodMonths: r.validityPeriodMonths,
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
    await db.insert(complianceEvaluations).values({
      verticalSlug: body.verticalSlug,
      geography: body.geography,
      overallStatus: scorecard.overallStatus,
      scoreBps: scorecard.scoreBps,
      summary: scorecard,
    });
  } catch {
    /* Evaluation log table non-blocking */
  }
  return reply
    .code(200)
    .send({ ...scorecard, ...(breakdowns ? { breakdowns } : {}) });
});

// Trade Regulatory Policies Matrix (Ticket #55)
app.get("/v1/compliance/policy/matrix", async (request) => {
  const querySchema = z.object({
    geography: z.string().default("ON"),
    vertical: z.string().optional(),
  });
  const q = querySchema.parse(request.query);
  const polWhere = [eq(tradeRegulatoryPolicies.active, true)];
  if (q.geography !== "*") {
    polWhere.push(eq(tradeRegulatoryPolicies.geography, q.geography));
  }
  if (q.vertical) {
    polWhere.push(eq(tradeRegulatoryPolicies.verticalSlug, q.vertical));
  }

  const rows = await db
    .select()
    .from(tradeRegulatoryPolicies)
    .where(and(...polWhere))
    .orderBy(
      asc(tradeRegulatoryPolicies.verticalSlug),
      desc(tradeRegulatoryPolicies.policyVersion),
    );

  return {
    geography: q.geography,
    policies: rows.map((r) => ({
      id: r.id,
      verticalSlug: r.verticalSlug,
      categorySlug: r.categorySlug,
      variantSlug: r.variantSlug,
      geography: r.geography,
      policyVersion: r.policyVersion,
      contractorMandatoryCodes: (r.contractorMandatoryCodes as string[]) ?? [],
      technicianMandatoryCodes: (r.technicianMandatoryCodes as string[]) ?? [],
      apprenticeEligible: r.apprenticeEligible,
      supervisorRatio: r.supervisorRatio,
      permitRequired: r.permitRequired,
      inspectionAuthority: r.inspectionAuthority,
      legalAuthorityDisclaimer: r.legalAuthorityDisclaimer,
      active: r.active,
    })),
  };
});

// Authoritative Credential Verification (Ticket #55)
app.post(
  "/v1/compliance/verify-credential",
  { preHandler: authenticate },
  async (request, reply) => {
    requireRole(actor(request), "ADMIN", "SUPER_ADMIN", "OPERATIONS_AGENT");
    const body = parse(
      z.object({
        credentialId: uuid,
        verificationSource: z.enum(["MANUAL_AUDIT", "REGULATOR_API"]),
        regulatorReference: z.string().trim().min(3),
        status: z.enum(["VERIFIED", "REJECTED", "EXPIRED", "SUSPENDED"]),
        limitations: z.string().optional(),
        auditorNotes: z.string().optional(),
      }),
      request.body,
    );

    const [existing] = await db
      .select()
      .from(credentials)
      .where(eq(credentials.id, body.credentialId))
      .limit(1);

    if (!existing) {
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: "Credential not found" });
    }

    const [cred] = await db
      .update(credentials)
      .set({
        status: body.status,
        verificationSource: body.verificationSource,
        regulatorReference: body.regulatorReference,
        verifiedByUserId: actor(request).id,
        checkedAt: new Date(),
        verifiedAt: body.status === "VERIFIED" ? new Date() : null,
        limitations: body.limitations ?? null,
        auditorNotes: body.auditorNotes ?? null,
      })
      .where(eq(credentials.id, body.credentialId))
      .returning();

    await audit(
      actor(request).id,
      "CREDENTIAL_VERIFIED",
      "CREDENTIAL",
      body.credentialId,
      existing,
      cred,
      {
        verificationSource: body.verificationSource,
        regulatorReference: body.regulatorReference,
      },
    );

    return {
      credential: {
        id: cred?.id,
        contractorId: cred?.contractorId,
        technicianId: cred?.technicianId,
        code: cred?.code,
        geography: cred?.geography,
        status: cred?.status,
        verificationSource: cred?.verificationSource,
        regulatorReference: cred?.regulatorReference,
        verifiedByUserId: cred?.verifiedByUserId,
        checkedAt: cred?.checkedAt ? cred.checkedAt.toISOString() : null,
        verifiedAt: cred?.verifiedAt ? cred.verifiedAt.toISOString() : null,
        expiryDate: cred?.expiryDate ?? null,
        limitations: cred?.limitations,
        auditorNotes: cred?.auditorNotes,
      },
    };
  },
);

// Trade-Specific Regulatory Eligibility Dispatch Check (Ticket #55)
app.post(
  "/v1/compliance/eligibility-check",
  { preHandler: authenticate },
  async (request, reply) => {
    const currentActor = actor(request);
    const body = parse(
      z.object({
        verticalSlug: z.string(),
        categorySlug: z.string().optional(),
        variantSlug: z.string().optional(),
        geography: z.string().default("ON"),
        contractorId: uuid,
        technicianId: uuid,
        isApprentice: z.boolean().default(false),
        supervisorTechnicianId: uuid.optional(),
      }),
      request.body,
    );

    // Enforce role / tenancy authorization
    const isOwner = currentActor.contractorId === body.contractorId;
    if (!isOwner && !isOps(currentActor)) {
      return reply.code(403).send({
        code: "FORBIDDEN",
        message: "Not permitted to inspect regulatory eligibility for this contractor",
      });
    }

    // Verify contractor exists
    const [contractorRec] = await db
      .select({ id: contractors.id })
      .from(contractors)
      .where(eq(contractors.id, body.contractorId))
      .limit(1);

    if (!contractorRec) {
      return reply.code(404).send({
        code: "CONTRACTOR_NOT_FOUND",
        message: "Contractor not found",
      });
    }

    // Verify technician exists and belongs to the specified contractor
    const [technicianRec] = await db
      .select({ id: technicians.id, contractorId: technicians.contractorId })
      .from(technicians)
      .where(eq(technicians.id, body.technicianId))
      .limit(1);

    if (!technicianRec) {
      return reply.code(404).send({
        code: "TECHNICIAN_NOT_FOUND",
        message: "Technician not found",
      });
    }

    if (technicianRec.contractorId !== body.contractorId) {
      return reply.code(422).send({
        code: "CONTRACTOR_TECHNICIAN_MISMATCH",
        message: "Technician does not belong to the specified contractor",
      });
    }

    // Verify supervisor technician if provided
    let supervisorCreds: any[] = [];
    if (body.supervisorTechnicianId) {
      const [supRec] = await db
        .select({ id: technicians.id, contractorId: technicians.contractorId })
        .from(technicians)
        .where(eq(technicians.id, body.supervisorTechnicianId))
        .limit(1);

      if (!supRec || supRec.contractorId !== body.contractorId) {
        return reply.code(422).send({
          code: "CONTRACTOR_TECHNICIAN_MISMATCH",
          message: "Supervisor technician does not belong to the specified contractor",
        });
      }

      const supRows = await db
        .select({
          id: credentials.id,
          code: credentials.code,
          geography: credentials.geography,
          status: credentials.status,
          verificationSource: credentials.verificationSource,
          regulatorReference: credentials.regulatorReference,
          expiryDate: credentials.expiryDate,
          checkedAt: credentials.checkedAt,
        })
        .from(credentials)
        .where(eq(credentials.technicianId, body.supervisorTechnicianId));

      supervisorCreds = supRows.map((c) => ({
        id: c.id,
        code: c.code,
        geography: c.geography,
        status: c.status,
        verificationSource: c.verificationSource as any,
        regulatorReference: c.regulatorReference ?? null,
        expiryDate: c.expiryDate ?? null,
        checkedAt: c.checkedAt ? c.checkedAt.toISOString() : null,
      }));
    }

    const geography = body.geography ?? "ON";

    const policyRows = await db
      .select()
      .from(tradeRegulatoryPolicies)
      .where(
        and(
          eq(tradeRegulatoryPolicies.verticalSlug, body.verticalSlug),
          eq(tradeRegulatoryPolicies.geography, geography),
          eq(tradeRegulatoryPolicies.active, true),
        ),
      );

    const resolvedPolicy = resolveRegulatoryPolicy(
      policyRows.map((p) => ({
        id: p.id,
        verticalSlug: p.verticalSlug,
        categorySlug: p.categorySlug,
        variantSlug: p.variantSlug,
        geography: p.geography,
        policyVersion: p.policyVersion,
        contractorMandatoryCodes: (p.contractorMandatoryCodes as string[]) ?? [],
        technicianMandatoryCodes: (p.technicianMandatoryCodes as string[]) ?? [],
        apprenticeEligible: p.apprenticeEligible,
        supervisorRatio: p.supervisorRatio ?? "1:1",
        permitRequired: p.permitRequired,
        inspectionAuthority: p.inspectionAuthority ?? null,
        legalAuthorityDisclaimer: p.legalAuthorityDisclaimer,
        active: p.active,
      })),
      {
        verticalSlug: body.verticalSlug,
        categorySlug: body.categorySlug,
        variantSlug: body.variantSlug,
        geography,
      },
    );

    if (!resolvedPolicy) {
      return reply.code(404).send({
        code: "POLICY_NOT_FOUND",
        message: `No active regulatory policy found for ${body.verticalSlug} in ${geography}`,
      });
    }

    const contractorCreds = await db
      .select({
        id: credentials.id,
        code: credentials.code,
        geography: credentials.geography,
        status: credentials.status,
        verificationSource: credentials.verificationSource,
        regulatorReference: credentials.regulatorReference,
        expiryDate: credentials.expiryDate,
        checkedAt: credentials.checkedAt,
      })
      .from(credentials)
      .where(eq(credentials.contractorId, body.contractorId));

    const technicianCreds = await db
      .select({
        id: credentials.id,
        code: credentials.code,
        geography: credentials.geography,
        status: credentials.status,
        verificationSource: credentials.verificationSource,
        regulatorReference: credentials.regulatorReference,
        expiryDate: credentials.expiryDate,
        checkedAt: credentials.checkedAt,
      })
      .from(credentials)
      .where(eq(credentials.technicianId, body.technicianId));

    const cCreds = contractorCreds.map((c) => ({
      id: c.id,
      code: c.code,
      geography: c.geography,
      status: c.status,
      verificationSource: c.verificationSource as any,
      regulatorReference: c.regulatorReference ?? null,
      expiryDate: c.expiryDate ?? null,
      checkedAt: c.checkedAt ? c.checkedAt.toISOString() : null,
    }));

    const tCreds = technicianCreds.map((c) => ({
      id: c.id,
      code: c.code,
      geography: c.geography,
      status: c.status,
      verificationSource: c.verificationSource as any,
      regulatorReference: c.regulatorReference ?? null,
      expiryDate: c.expiryDate ?? null,
      checkedAt: c.checkedAt ? c.checkedAt.toISOString() : null,
    }));

    const eligibility = evaluateRegulatoryEligibility({
      policy: resolvedPolicy,
      contractorCredentials: cCreds,
      technicianCredentials: tCreds,
      isApprentice: body.isApprentice,
      supervisorCredentials: supervisorCreds,
    });

    return eligibility;
  },
);

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

    const [contractor] = await db
      .select({
        name: contractors.name,
        service_areas: contractors.serviceAreas,
        vertical_ids: contractors.verticalIds,
      })
      .from(contractors)
      .where(eq(contractors.id, contractorId))
      .limit(1);

    if (!contractor)
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: "Contractor not found" });

    const techSubquery = db
      .select({ id: technicians.id })
      .from(technicians)
      .where(eq(technicians.contractorId, contractorId));

    const credRows = await db
      .select({
        code: credentials.code,
        geography: credentials.geography,
        status: credentials.status,
        expiry_date: credentials.expiryDate,
        document_key: credentials.documentKey,
      })
      .from(credentials)
      .where(
        or(
          eq(credentials.contractorId, contractorId),
          inArray(credentials.technicianId, techSubquery),
        ),
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
      const [vRow] = await db
        .select({ slug: verticals.slug })
        .from(verticals)
        .where(eq(verticals.id, contractor.vertical_ids[0] as string))
        .limit(1);
      if (vRow?.slug) verticalSlug = vRow.slug;
    }
    const entityLevel = query?.entityLevel;
    const applicable = filterComplianceStandards(
      DEFAULT_COMPLIANCE_STANDARDS,
      verticalSlug,
      geography,
      entityLevel,
    );
    const creds = credRows.map((c) => ({
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
        const [tech] = await db
          .select({ id: technicians.id })
          .from(technicians)
          .where(eq(technicians.userId, actorId))
          .limit(1);
        if (tech?.id) targetTechnicianId = tech.id;
        else
          return reply
            .code(400)
            .send({
              code: "TECHNICIAN_NOT_FOUND",
              message: "No technician profile linked",
            });
      }
    }
    const [inserted] = await db
      .insert(credentials)
      .values({
        contractorId: targetContractorId,
        technicianId: targetTechnicianId,
        code: body.code,
        geography: body.geography,
        status: "PENDING",
        expiryDate: body.expiryDate ?? null,
        documentKey: body.documentKey,
      })
      .returning({ id: credentials.id });

    const credId = inserted?.id;
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
    const [inserted] = await db
      .insert(properties)
      .values({
        customerId: actor(request).id,
        label: body.label,
        addressLine1: body.addressLine1,
        city: body.city,
        region: body.region,
        postalCode: body.postalCode,
        latitude: body.latitude !== undefined ? body.latitude.toString() : null,
        longitude: body.longitude !== undefined ? body.longitude.toString() : null,
      })
      .returning({ id: properties.id });

    const id = inserted?.id;
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
  return await db
    .select({
      id: properties.id,
      label: properties.label,
      address_line1: properties.addressLine1,
      city: properties.city,
      region: properties.region,
      postal_code: properties.postalCode,
    })
    .from(properties)
    .where(
      and(
        eq(properties.customerId, actor(request).id),
        isNull(properties.deletedAt),
      ),
    )
    .orderBy(desc(properties.createdAt));
});

app.post(
  "/v1/service-requests",
  { preHandler: authenticate },
  async (request, reply) => {
    requireRole(actor(request), "CUSTOMER");
    const body = parse(createRequestSchema, request.body);

    const [validProp] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(
        and(
          eq(properties.id, body.propertyId),
          eq(properties.customerId, actor(request).id),
          isNull(properties.deletedAt),
        ),
      )
      .limit(1);

    const [validIssue] = await db
      .select({ id: issueTypes.id })
      .from(issueTypes)
      .innerJoin(serviceCategories, eq(serviceCategories.id, issueTypes.categoryId))
      .innerJoin(verticals, eq(verticals.id, serviceCategories.verticalId))
      .where(
        and(
          eq(issueTypes.id, body.issueTypeId),
          eq(issueTypes.active, true),
          eq(serviceCategories.id, body.categoryId),
          eq(serviceCategories.active, true),
          eq(verticals.id, body.verticalId),
          eq(verticals.active, true),
        ),
      )
      .limit(1);

    if (!validProp || !validIssue)
      return reply
        .code(422)
        .send({
          code: "INVALID_REQUEST_CONFIGURATION",
          message: "Property or vertical service selection is invalid",
        });

    const [result] = await db
      .insert(serviceRequests)
      .values({
        customerId: actor(request).id,
        propertyId: body.propertyId,
        verticalId: body.verticalId,
        categoryId: body.categoryId,
        issueTypeId: body.issueTypeId,
        urgency: body.urgency,
        status: "SUBMITTED",
        description: body.description,
        equipment: body.equipment,
        preferredStartsAt: body.preferredStartsAt ? new Date(body.preferredStartsAt) : null,
        preferredEndsAt: body.preferredEndsAt ? new Date(body.preferredEndsAt) : null,
        attachmentKeys: body.attachmentKeys,
      })
      .returning({ id: serviceRequests.id });

    const id = result?.id;
    if (!id) throw new Error("INSERT_FAILED");
    await audit(
      actor(request).id,
      "SERVICE_REQUEST_SUBMITTED",
      "SERVICE_REQUEST",
      id,
      { status: "DRAFT" },
      { status: "SUBMITTED" },
    );
    return reply
      .code(201)
      .send({ id, serviceRequestId: id, status: "SUBMITTED" });
  },
);

app.get(
  "/v1/service-requests",
  { preHandler: authenticate },
  async (request) => {
    const isOperations = isOps(actor(request));
    if (isOperations) {
      return await db
        .select({
          id: serviceRequests.id,
          urgency: serviceRequests.urgency,
          status: serviceRequests.status,
          description: serviceRequests.description,
          created_at: serviceRequests.createdAt,
          property_label: properties.label,
          city: properties.city,
          vertical_name: verticals.name,
          category_name: serviceCategories.name,
          issue_name: issueTypes.name,
          customer_name: users.displayName,
        })
        .from(serviceRequests)
        .innerJoin(properties, eq(properties.id, serviceRequests.propertyId))
        .innerJoin(verticals, eq(verticals.id, serviceRequests.verticalId))
        .innerJoin(serviceCategories, eq(serviceCategories.id, serviceRequests.categoryId))
        .innerJoin(issueTypes, eq(issueTypes.id, serviceRequests.issueTypeId))
        .innerJoin(users, eq(users.id, serviceRequests.customerId))
        .orderBy(desc(serviceRequests.createdAt))
        .limit(50);
    } else {
      return await db
        .select({
          id: serviceRequests.id,
          urgency: serviceRequests.urgency,
          status: serviceRequests.status,
          description: serviceRequests.description,
          created_at: serviceRequests.createdAt,
          property_label: properties.label,
          city: properties.city,
          vertical_name: verticals.name,
          category_name: serviceCategories.name,
          issue_name: issueTypes.name,
        })
        .from(serviceRequests)
        .innerJoin(properties, eq(properties.id, serviceRequests.propertyId))
        .innerJoin(verticals, eq(verticals.id, serviceRequests.verticalId))
        .innerJoin(serviceCategories, eq(serviceCategories.id, serviceRequests.categoryId))
        .innerJoin(issueTypes, eq(issueTypes.id, serviceRequests.issueTypeId))
        .where(eq(serviceRequests.customerId, actor(request).id))
        .orderBy(desc(serviceRequests.createdAt))
        .limit(50);
    }
  },
);

app.get(
  "/v1/service-requests/:id",
  { preHandler: authenticate },
  async (request, reply) => {
    const id = parse(z.object({ id: uuid }), request.params).id;
    const [result] = await db
      .select({
        id: serviceRequests.id,
        customer_id: serviceRequests.customerId,
        property_id: serviceRequests.propertyId,
        vertical_id: serviceRequests.verticalId,
        category_id: serviceRequests.categoryId,
        issue_type_id: serviceRequests.issueTypeId,
        urgency: serviceRequests.urgency,
        status: serviceRequests.status,
        description: serviceRequests.description,
        equipment: serviceRequests.equipment,
        preferred_starts_at: serviceRequests.preferredStartsAt,
        preferred_ends_at: serviceRequests.preferredEndsAt,
        attachment_keys: serviceRequests.attachmentKeys,
        created_at: serviceRequests.createdAt,
        updated_at: serviceRequests.updatedAt,
        job_id: jobs.id,
        technician_id: jobs.technicianId,
        contractor_id: jobs.contractorId,
        technician_name: technicians.displayName,
        contractor_name: contractors.name,
      })
      .from(serviceRequests)
      .leftJoin(jobs, eq(jobs.serviceRequestId, serviceRequests.id))
      .leftJoin(technicians, eq(technicians.id, jobs.technicianId))
      .leftJoin(contractors, eq(contractors.id, jobs.contractorId))
      .where(eq(serviceRequests.id, id))
      .limit(1);

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
  let jobWhere: any = undefined;
  if (isOps(currentActor)) {
    jobWhere = undefined;
  } else if (currentActor.contractorId) {
    jobWhere = eq(jobs.contractorId, currentActor.contractorId);
  } else {
    jobWhere = eq(technicians.userId, currentActor.id);
  }

  const queryBuilder = db
    .select({
      id: jobs.id,
      status: jobs.status,
      service_request_id: jobs.serviceRequestId,
      contractor_id: jobs.contractorId,
      technician_id: jobs.technicianId,
      created_at: jobs.createdAt,
      updated_at: jobs.updatedAt,
      contractor_name: contractors.name,
      technician_name: technicians.displayName,
      urgency: serviceRequests.urgency,
      request_description: serviceRequests.description,
      address_line1: properties.addressLine1,
      city: properties.city,
    })
    .from(jobs)
    .innerJoin(contractors, eq(contractors.id, jobs.contractorId))
    .innerJoin(technicians, eq(technicians.id, jobs.technicianId))
    .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
    .innerJoin(properties, eq(properties.id, serviceRequests.propertyId));

  if (jobWhere) {
    return await queryBuilder.where(jobWhere).orderBy(desc(jobs.createdAt)).limit(50);
  }
  return await queryBuilder.orderBy(desc(jobs.createdAt)).limit(50);
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
    const outcome = await db.transaction(async (tx) => {
      const current = await tx
        .select({
          status: serviceRequests.status,
          customerId: serviceRequests.customerId,
          technicianUserId: technicians.userId,
          contractorId: jobs.contractorId,
        })
        .from(serviceRequests)
        .leftJoin(jobs, eq(jobs.serviceRequestId, serviceRequests.id))
        .leftJoin(technicians, eq(technicians.id, jobs.technicianId))
        .where(eq(serviceRequests.id, id))
        .for("update", { of: serviceRequests });

      const record = current[0];
      if (!record) throw new Error("NOT_FOUND");
      const customerCancellation =
        record.customerId === actor(request).id && body.to === "CANCELLED";
      const technicianStates: readonly ServiceRequestStatus[] = [
        "TECHNICIAN_EN_ROUTE",
        "TECHNICIAN_ARRIVED",
        "ASSESSMENT_IN_PROGRESS",
        "QUOTE_PENDING",
        "WORK_IN_PROGRESS",
        "COMPLETION_PENDING",
      ];
      const technicianOwns =
        record.technicianUserId === actor(request).id &&
        technicianStates.includes(body.to);
      const contractorOwns = Boolean(
        actor(request).contractorId &&
        record.contractorId === actor(request).contractorId &&
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

      await tx
        .update(serviceRequests)
        .set({ status: body.to, updatedAt: new Date() })
        .where(eq(serviceRequests.id, id));

      await tx
        .update(jobs)
        .set({ status: body.to, updatedAt: new Date() })
        .where(eq(jobs.serviceRequestId, id));

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

  const [vertical] = await db
    .select({ id: verticals.id, slug: verticals.slug, name: verticals.name })
    .from(verticals)
    .where(
      or(
        sql`lower(${verticals.slug}) = lower(${verticalSlug})`,
        sql`lower(${verticals.name}) = lower(${verticalSlug})`,
      ),
    )
    .limit(1);

  if (!vertical) {
    return reply
      .code(404)
      .send({
        code: "NOT_FOUND",
        message: `Vertical '${verticalSlug}' not found`,
      });
  }

  const activeTechs = await db
    .select({
      id: technicians.id,
      workload: technicians.workload,
      emergency_available: technicians.emergencyAvailable,
    })
    .from(technicians)
    .innerJoin(contractors, eq(contractors.id, technicians.contractorId))
    .where(
      and(
        eq(technicians.active, true),
        eq(contractors.status, "VERIFIED"),
        sql`${contractors.verticalIds} ? ${vertical.id}`,
      ),
    );

  const [jobCountRow] = await db
    .select({ count: sql<string>`count(*)::text` })
    .from(jobs)
    .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
    .where(
      and(
        eq(serviceRequests.verticalId, vertical.id),
        sql`${jobs.status} NOT IN ('COMPLETED', 'CANCELLED', 'CLOSED')`,
      ),
    );

  const activeJobsCount = parseInt(jobCountRow?.count ?? "0", 10);

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

const getCandidatesHandler = async (request: FastifyRequest, reply: FastifyReply) => {
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

    const [service] = await db
      .select({
        vertical_id: serviceRequests.verticalId,
        urgency: serviceRequests.urgency,
        region: properties.region,
        latitude: properties.latitude,
        longitude: properties.longitude,
        config: verticals.config,
      })
      .from(serviceRequests)
      .innerJoin(properties, eq(properties.id, serviceRequests.propertyId))
      .innerJoin(verticals, eq(verticals.id, serviceRequests.verticalId))
      .where(eq(serviceRequests.id, requestId))
      .limit(1);

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

    const pLat = service.latitude ?? "0";
    const pLng = service.longitude ?? "0";

    const techRows = await db
      .select({
        technician_id: technicians.id,
        contractor_id: technicians.contractorId,
        distance_km: sql<string>`COALESCE(6371 * acos(least(1,cos(radians(${pLat}::numeric))*cos(radians(${technicians.latitude}))*cos(radians(${technicians.longitude})-radians(${pLng}::numeric))+sin(radians(${pLat}::numeric))*sin(radians(${technicians.latitude})))),9999)::text`,
        rating_bps: contractors.ratingBps,
        completion_rate_bps: contractors.completionRateBps,
        avg_response_minutes: contractors.avgResponseMinutes,
        workload: technicians.workload,
        emergency_available: technicians.emergencyAvailable,
        credentials: sql<unknown>`COALESCE(json_agg(json_build_object('code',${credentials.code},'status',${credentials.status},'expiryDate',${credentials.expiryDate})) FILTER(WHERE ${credentials.id} IS NOT NULL),'[]')`,
      })
      .from(technicians)
      .innerJoin(contractors, eq(contractors.id, technicians.contractorId))
      .leftJoin(credentials, eq(credentials.technicianId, technicians.id))
      .where(
        and(
          eq(technicians.active, true),
          eq(contractors.status, "VERIFIED"),
          sql`${contractors.verticalIds} ? ${service.vertical_id}`,
        ),
      )
      .groupBy(technicians.id, contractors.id);

    const candidates = rankCandidates(
      techRows.map((row) => ({
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
};

app.get("/v1/dispatch/:requestId/candidates", { preHandler: authenticate }, getCandidatesHandler);
app.get("/v1/dispatch/:requestId/match", { preHandler: authenticate }, getCandidatesHandler);

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
    const assigned = await db.transaction(async (tx) => {
      const [service] = await tx
        .select({
          status: serviceRequests.status,
          vertical_id: serviceRequests.verticalId,
          category_id: serviceRequests.categoryId,
          issue_type_id: serviceRequests.issueTypeId,
          urgency: serviceRequests.urgency,
          region: properties.region,
          config: verticals.config,
          vertical_slug: verticals.slug,
          category_slug: serviceCategories.slug,
          variant_slug: issueTypes.slug,
        })
        .from(serviceRequests)
        .innerJoin(properties, eq(properties.id, serviceRequests.propertyId))
        .innerJoin(verticals, eq(verticals.id, serviceRequests.verticalId))
        .leftJoin(serviceCategories, eq(serviceCategories.id, serviceRequests.categoryId))
        .leftJoin(issueTypes, eq(issueTypes.id, serviceRequests.issueTypeId))
        .where(eq(serviceRequests.id, requestId))
        .for("update", { of: serviceRequests });

      if (!service) throw new Error("NOT_FOUND");
      assertTransition(service.status, "ASSIGNED");

      const [existingJob] = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(eq(jobs.serviceRequestId, requestId))
        .limit(1);

      if (existingJob) throw new Error("ALREADY_ASSIGNED");

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

      const [candidate] = await tx
        .select({
          technician_id: technicians.id,
          contractor_id: technicians.contractorId,
          rating_bps: contractors.ratingBps,
          completion_rate_bps: contractors.completionRateBps,
          avg_response_minutes: contractors.avgResponseMinutes,
          workload: technicians.workload,
          emergency_available: technicians.emergencyAvailable,
          credentials: sql<unknown>`COALESCE(json_agg(json_build_object('code',${credentials.code},'status',${credentials.status},'expiryDate',${credentials.expiryDate})) FILTER(WHERE ${credentials.id} IS NOT NULL),'[]')`,
        })
        .from(technicians)
        .innerJoin(contractors, eq(contractors.id, technicians.contractorId))
        .leftJoin(
          credentials,
          and(
            or(
              eq(credentials.technicianId, technicians.id),
              eq(credentials.contractorId, contractors.id),
            ),
            or(
              eq(credentials.geography, "*"),
              eq(credentials.geography, service.region),
            ),
          ),
        )
        .where(
          and(
            eq(technicians.id, body.technicianId),
            eq(technicians.active, true),
            eq(contractors.status, "VERIFIED"),
            sql`${contractors.verticalIds} ? ${service.vertical_id}`,
          ),
        )
        .groupBy(technicians.id, contractors.id);

      if (!candidate) {
        throw new Error("INELIGIBLE_TECHNICIAN");
      }

      // Enforce fail-closed trade regulatory eligibility policy (Ticket #55 / PR #65)
      const matchingPolicies = await tx
        .select()
        .from(tradeRegulatoryPolicies)
        .where(
          and(
            eq(tradeRegulatoryPolicies.verticalSlug, service.vertical_slug),
            eq(tradeRegulatoryPolicies.geography, service.region),
            eq(tradeRegulatoryPolicies.active, true),
          ),
        );

      const resolvedPolicy = resolveRegulatoryPolicy(
        matchingPolicies.map((p) => ({
          id: p.id,
          verticalSlug: p.verticalSlug,
          categorySlug: p.categorySlug,
          variantSlug: p.variantSlug,
          geography: p.geography,
          policyVersion: p.policyVersion,
          contractorMandatoryCodes: (p.contractorMandatoryCodes as string[]) ?? [],
          technicianMandatoryCodes: (p.technicianMandatoryCodes as string[]) ?? [],
          apprenticeEligible: p.apprenticeEligible,
          supervisorRatio: p.supervisorRatio ?? "1:1",
          permitRequired: p.permitRequired,
          inspectionAuthority: p.inspectionAuthority ?? null,
          legalAuthorityDisclaimer: p.legalAuthorityDisclaimer,
          active: p.active,
        })),
        {
          verticalSlug: service.vertical_slug,
          categorySlug: service.category_slug ?? undefined,
          variantSlug: service.variant_slug ?? undefined,
          geography: service.region,
        },
      );

      if (resolvedPolicy) {
        const cCredRows = await tx
          .select({
            id: credentials.id,
            code: credentials.code,
            geography: credentials.geography,
            status: credentials.status,
            verificationSource: credentials.verificationSource,
            regulatorReference: credentials.regulatorReference,
            expiryDate: credentials.expiryDate,
            checkedAt: credentials.checkedAt,
          })
          .from(credentials)
          .where(eq(credentials.contractorId, candidate.contractor_id));

        const tCredRows = await tx
          .select({
            id: credentials.id,
            code: credentials.code,
            geography: credentials.geography,
            status: credentials.status,
            verificationSource: credentials.verificationSource,
            regulatorReference: credentials.regulatorReference,
            expiryDate: credentials.expiryDate,
            checkedAt: credentials.checkedAt,
          })
          .from(credentials)
          .where(eq(credentials.technicianId, body.technicianId));

        const cCreds = cCredRows.map((c) => ({
          id: c.id,
          code: c.code,
          geography: c.geography,
          status: c.status,
          verificationSource: c.verificationSource as any,
          regulatorReference: c.regulatorReference ?? null,
          expiryDate: c.expiryDate ?? null,
          checkedAt: c.checkedAt ? c.checkedAt.toISOString() : null,
        }));

        const tCreds = tCredRows.map((c) => ({
          id: c.id,
          code: c.code,
          geography: c.geography,
          status: c.status,
          verificationSource: c.verificationSource as any,
          regulatorReference: c.regulatorReference ?? null,
          expiryDate: c.expiryDate ?? null,
          checkedAt: c.checkedAt ? c.checkedAt.toISOString() : null,
        }));

        const eligibility = evaluateRegulatoryEligibility({
          policy: resolvedPolicy,
          contractorCredentials: cCreds,
          technicianCredentials: tCreds,
          isApprentice: false,
        });

        if (!eligibility.eligible) {
          const err = new Error(
            `Regulatory compliance verification failed: ${eligibility.reasons.join("; ")}`,
          );
          (err as any).statusCode = 422;
          (err as any).code = "REGULATORY_ELIGIBILITY_FAILED";
          (err as any).details = {
            contractorDeficiencies: eligibility.contractorDeficiencies,
            technicianDeficiencies: eligibility.technicianDeficiencies,
            reasons: eligibility.reasons,
            inspectionAuthority: eligibility.inspectionAuthority,
            policyVersion: eligibility.policyVersion,
          };
          throw err;
        }
      }

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
        !ranked.some((item) => item.technicianId === body.technicianId)
      )
        throw new Error("INELIGIBLE_TECHNICIAN");

      const [job] = await tx
        .insert(jobs)
        .values({
          serviceRequestId: requestId,
          contractorId: candidate.contractor_id,
          technicianId: body.technicianId,
          status: "ASSIGNED",
        })
        .returning({ id: jobs.id });

      await tx
        .update(serviceRequests)
        .set({ status: "ASSIGNED", updatedAt: new Date() })
        .where(eq(serviceRequests.id, requestId));

      return job;
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
    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          id: jobs.id,
          technician_user_id: technicians.userId,
          status: jobs.status,
        })
        .from(jobs)
        .innerJoin(technicians, eq(technicians.id, jobs.technicianId))
        .where(eq(jobs.id, jobId))
        .for("update", { of: jobs });

      if (!row) throw new Error("NOT_FOUND");
      if (row.technician_user_id !== actor(request).id)
        throw new Error("FORBIDDEN");
      if (
        ![
          "QUOTE_PENDING",
          "ASSESSMENT_IN_PROGRESS",
          "QUOTE_REJECTED",
        ].includes(row.status)
      )
        throw new Error("QUOTE_NOT_ALLOWED");

      const discountCents = body.discountCents ?? 0;
      const totals = quoteTotals(
        body.items,
        body.platformFeeCents,
        discountCents,
        body.taxCents,
      );

      const [versionRow] = await tx
        .select({ version: sql<number>`COALESCE(MAX(${quotes.version}),0)+1` })
        .from(quotes)
        .where(eq(quotes.jobId, jobId));

      const version = Number(versionRow?.version ?? 1);

      const [quote] = await tx
        .insert(quotes)
        .values({
          jobId,
          version,
          status: "SUBMITTED",
          contractorSubtotalCents: totals.contractorSubtotalCents,
          platformFeeCents: body.platformFeeCents,
          discountCents,
          taxCents: body.taxCents,
          customerTotalCents: totals.customerTotalCents,
          notes: body.notes ?? null,
          expiresAt: new Date(body.expiresAt),
        })
        .returning({ id: quotes.id });

      const quoteId = quote?.id;
      if (!quoteId) throw new Error("INSERT_FAILED");

      for (const [index, item] of body.items.entries()) {
        const itemSubtotal = totals.itemSubtotals[index];
        if (itemSubtotal === undefined)
          throw new Error("QUOTE_CALCULATION_FAILED");
        await tx.insert(quoteItems).values({
          quoteId,
          type: item.type,
          title: item.title,
          description: item.description ?? null,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          subtotalCents: itemSubtotal,
          materialMetadata: item.materialMetadata ? (item.materialMetadata as any) : null,
        });
      }

      await tx
        .update(jobs)
        .set({ status: "QUOTE_SUBMITTED", updatedAt: new Date() })
        .where(eq(jobs.id, jobId));

      const [jobRecord] = await tx
        .select({ serviceRequestId: jobs.serviceRequestId })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (jobRecord) {
        await tx
          .update(serviceRequests)
          .set({ status: "QUOTE_SUBMITTED", updatedAt: new Date() })
          .where(eq(serviceRequests.id, jobRecord.serviceRequestId));
      }

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
    const rows = await db
      .select({
        customer_id: serviceRequests.customerId,
        technician_user_id: technicians.userId,
        quote_id: quotes.id,
        status: quotes.status,
        version: quotes.version,
        customer_total_cents: quotes.customerTotalCents,
        items: sql<unknown>`COALESCE(json_agg(json_build_object('id',${quoteItems.id},'type',${quoteItems.type},'title',${quoteItems.title},'description',${quoteItems.description},'quantity',${quoteItems.quantity},'unitPriceCents',${quoteItems.unitPriceCents},'subtotalCents',${quoteItems.subtotalCents},'materialMetadata',${quoteItems.materialMetadata})) FILTER(WHERE ${quoteItems.id} IS NOT NULL),'[]')`,
      })
      .from(jobs)
      .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
      .innerJoin(technicians, eq(technicians.id, jobs.technicianId))
      .innerJoin(quotes, eq(quotes.jobId, jobs.id))
      .leftJoin(quoteItems, eq(quoteItems.quoteId, quotes.id))
      .where(eq(jobs.id, jobId))
      .groupBy(serviceRequests.customerId, technicians.userId, quotes.id);

    if (rows.length === 0)
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: "No quotes found" });
    const owns =
      rows[0]?.customer_id === actor(request).id ||
      rows[0]?.technician_user_id === actor(request).id ||
      isOps(actor(request));
    if (!owns)
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: "Not permitted" });
    return rows;
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

    const outcome = await db.transaction(async (tx) => {
      const requestHash = `quote:${quoteId}`;
      const [existing] = await tx
        .select({
          actor_id: idempotencyKeys.actorId,
          request_hash: idempotencyKeys.requestHash,
          response: idempotencyKeys.response,
        })
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, idempotencyKey))
        .limit(1);

      if (
        existing &&
        (existing.actor_id !== actor(request).id ||
          existing.request_hash !== requestHash)
      )
        throw new Error("IDEMPOTENCY_KEY_REUSED");
      if (existing?.response)
        return existing.response as {
          quoteId: string;
          scheduleId: string;
          milestones: unknown[];
        };

      await tx.insert(idempotencyKeys).values({
        key: idempotencyKey,
        actorId: actor(request).id,
        requestHash,
      });

      const [row] = await tx
        .select({
          job_id: quotes.jobId,
          customer_id: serviceRequests.customerId,
          vertical_id: serviceRequests.verticalId,
          status: quotes.status,
          expires_at: quotes.expiresAt,
          customer_total_cents: quotes.customerTotalCents,
          currency: quotes.currency,
        })
        .from(quotes)
        .innerJoin(jobs, eq(jobs.id, quotes.jobId))
        .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
        .where(eq(quotes.id, quoteId))
        .for("update", { of: quotes });

      if (!row) throw new Error("NOT_FOUND");
      if (row.customer_id !== actor(request).id) throw new Error("FORBIDDEN");
      if (
        row.status !== "SUBMITTED" ||
        (row.expires_at && row.expires_at <= new Date())
      )
        throw new Error("QUOTE_UNAVAILABLE");

      const rules = await tx
        .select({
          id: paymentRules.id,
          min_amount_cents: paymentRules.minAmountCents,
          max_amount_cents: paymentRules.maxAmountCents,
          rule: paymentRules.rule,
        })
        .from(paymentRules)
        .where(
          and(
            eq(paymentRules.verticalId, row.vertical_id),
            eq(paymentRules.active, true),
          ),
        );

      const paymentRulesList: PaymentRule[] = rules.map((rule) => {
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
        paymentRulesList,
        row.vertical_id,
        Number(row.customer_total_cents),
      );

      const [schedule] = await tx
        .insert(paymentSchedules)
        .values({
          quoteId,
          totalCents: Number(row.customer_total_cents),
          currency: row.currency,
        })
        .returning({ id: paymentSchedules.id });

      const scheduleId = schedule?.id;
      if (!scheduleId) throw new Error("INSERT_FAILED");

      for (const milestone of milestones) {
        await tx.insert(paymentMilestones).values({
          scheduleId,
          sequence: milestone.sequence,
          triggerName: milestone.trigger,
          amountCents: milestone.amountCents,
          evidenceRequired: milestone.evidenceRequired,
        });
      }

      await tx
        .update(quotes)
        .set({
          status: "ACCEPTED",
          acceptedAt: new Date(),
          acceptedBy: actor(request).id,
        })
        .where(eq(quotes.id, quoteId));

      await tx
        .update(quotes)
        .set({ status: "SUPERSEDED" })
        .where(
          and(
            eq(quotes.jobId, row.job_id),
            sql`${quotes.id} <> ${quoteId}`,
            eq(quotes.status, "SUBMITTED"),
          ),
        );

      await tx
        .update(jobs)
        .set({ status: "WORK_SCHEDULED", updatedAt: new Date() })
        .where(eq(jobs.id, row.job_id));

      const [jobRecord] = await tx
        .select({ serviceRequestId: jobs.serviceRequestId })
        .from(jobs)
        .where(eq(jobs.id, row.job_id))
        .limit(1);

      if (jobRecord) {
        await tx
          .update(serviceRequests)
          .set({ status: "WORK_SCHEDULED", updatedAt: new Date() })
          .where(eq(serviceRequests.id, jobRecord.serviceRequestId));
      }

      const response = { quoteId, scheduleId, milestones };
      await tx
        .update(idempotencyKeys)
        .set({ response })
        .where(eq(idempotencyKeys.key, idempotencyKey));

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

    const outcome = await db.transaction(async (tx) => {
      const [present] = await tx
        .select({
          id: paymentTransactions.id,
          status: paymentTransactions.status,
        })
        .from(paymentTransactions)
        .innerJoin(
          paymentMilestones,
          eq(paymentMilestones.id, paymentTransactions.milestoneId),
        )
        .innerJoin(
          paymentSchedules,
          eq(paymentSchedules.id, paymentMilestones.scheduleId),
        )
        .innerJoin(quotes, eq(quotes.id, paymentSchedules.quoteId))
        .innerJoin(jobs, eq(jobs.id, quotes.jobId))
        .innerJoin(
          serviceRequests,
          eq(serviceRequests.id, jobs.serviceRequestId),
        )
        .where(
          and(
            eq(paymentTransactions.idempotencyKey, idempotencyKey),
            eq(serviceRequests.customerId, actor(request).id),
          ),
        )
        .limit(1);

      if (present) return present;

      const [row] = await tx
        .select({
          amount_cents: paymentMilestones.amountCents,
          currency: paymentSchedules.currency,
          status: paymentMilestones.status,
          customer_id: serviceRequests.customerId,
          sequence: paymentMilestones.sequence,
          schedule_id: paymentMilestones.scheduleId,
        })
        .from(paymentMilestones)
        .innerJoin(
          paymentSchedules,
          eq(paymentSchedules.id, paymentMilestones.scheduleId),
        )
        .innerJoin(quotes, eq(quotes.id, paymentSchedules.quoteId))
        .innerJoin(jobs, eq(jobs.id, quotes.jobId))
        .innerJoin(
          serviceRequests,
          eq(serviceRequests.id, jobs.serviceRequestId),
        )
        .where(eq(paymentMilestones.id, milestoneId))
        .for("update", { of: paymentMilestones });

      if (!row) throw new Error("NOT_FOUND");
      if (row.customer_id !== actor(request).id) throw new Error("FORBIDDEN");
      if (!["PENDING", "REQUIRES_ACTION"].includes(row.status))
        throw new Error("MILESTONE_UNAVAILABLE");

      const [prior] = await tx
        .select({ id: paymentMilestones.id })
        .from(paymentMilestones)
        .where(
          and(
            eq(paymentMilestones.scheduleId, row.schedule_id),
            sql`${paymentMilestones.sequence} < ${row.sequence}`,
            sql`${paymentMilestones.status} NOT IN ('PAID', 'WAIVED')`,
          ),
        )
        .limit(1);

      if (prior) throw new Error("PRIOR_MILESTONE_REQUIRED");

      const ref = `local_${crypto.randomUUID()}`;
      const [saved] = await tx
        .insert(paymentTransactions)
        .values({
          milestoneId,
          provider: "LOCAL_TEST",
          providerReference: ref,
          idempotencyKey,
          amountCents: Number(row.amount_cents),
          currency: row.currency,
          status: "PAID",
        })
        .returning({ id: paymentTransactions.id });

      await tx
        .update(paymentMilestones)
        .set({ status: "PAID", paidAt: new Date() })
        .where(eq(paymentMilestones.id, milestoneId));

      return {
        transactionId: saved?.id,
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
    const complete = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          technician_user_id: technicians.userId,
          status: jobs.status,
          property_id: serviceRequests.propertyId,
          vertical_id: serviceRequests.verticalId,
          customer_id: serviceRequests.customerId,
          contractor_id: jobs.contractorId,
        })
        .from(jobs)
        .innerJoin(technicians, eq(technicians.id, jobs.technicianId))
        .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
        .where(eq(jobs.id, jobId))
        .for("update", { of: jobs });

      if (!row) throw new Error("NOT_FOUND");
      if (
        !isOps(actor(request)) &&
        row.technician_user_id !== actor(request).id
      )
        throw new Error("FORBIDDEN");

      if (row.status === "WORK_IN_PROGRESS") {
        assertTransition(row.status, "COMPLETION_PENDING");
        await tx
          .update(jobs)
          .set({ status: "COMPLETION_PENDING" })
          .where(eq(jobs.id, jobId));
      }

      const [final] = await tx
        .select({ status: jobs.status })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .for("update");

      const status = final?.status;
      if (!status) throw new Error("NOT_FOUND");
      assertTransition(status, "COMPLETED");

      await tx
        .update(jobs)
        .set({
          status: "COMPLETED",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, jobId));

      const [jobRecord] = await tx
        .select({ serviceRequestId: jobs.serviceRequestId })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (jobRecord) {
        await tx
          .update(serviceRequests)
          .set({ status: "COMPLETED", updatedAt: new Date() })
          .where(eq(serviceRequests.id, jobRecord.serviceRequestId));
      }

      const [record] = await tx
        .insert(serviceRecords)
        .values({
          propertyId: row.property_id,
          jobId,
          verticalId: row.vertical_id,
          summary: body.summary,
          equipment: body.equipment,
          completedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: serviceRecords.jobId,
          set: { summary: body.summary },
        })
        .returning({ id: serviceRecords.id });

      await tx
        .insert(customerContractorRelationships)
        .values({
          customerId: row.customer_id,
          contractorId: row.contractor_id,
          acquisitionSource: "PLATFORM_INTRODUCTION",
          firstPlatformJobId: jobId,
          lastPlatformJobId: jobId,
          repeatJobCount: 0,
        })
        .onConflictDoUpdate({
          target: [
            customerContractorRelationships.customerId,
            customerContractorRelationships.contractorId,
          ],
          set: {
            lastPlatformJobId: jobId,
            repeatJobCount: sql`${customerContractorRelationships.repeatJobCount} + 1`,
            updatedAt: new Date(),
          },
        });

      return { serviceRecordId: record?.id, status: "COMPLETED" as const };
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

    const [verified] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
      .where(
        and(
          eq(jobs.id, jobId),
          eq(serviceRequests.customerId, actor(request).id),
          sql`${jobs.status} IN ('COMPLETED', 'CLOSED')`,
        ),
      )
      .limit(1);

    if (!verified)
      return reply
        .code(422)
        .send({
          code: "REVIEW_NOT_ELIGIBLE",
          message: "Only completed jobs can be reviewed",
        });

    const [result] = await db
      .insert(reviews)
      .values({
        jobId,
        customerId: actor(request).id,
        overall: body.overall,
        quality: body.quality ?? null,
        professionalism: body.professionalism ?? null,
        timeliness: body.timeliness ?? null,
        communication: body.communication ?? null,
        comment: body.comment ?? null,
      })
      .onConflictDoNothing({ target: reviews.jobId })
      .returning({ id: reviews.id });

    if (!result)
      return reply
        .code(409)
        .send({
          code: "DUPLICATE_REVIEW",
          message: "A review already exists for this job",
        });

    await audit(actor(request).id, "REVIEW_SUBMITTED", "JOB", jobId, null, {
      reviewId: result.id,
    });
    return reply.code(201).send({ id: result.id });
  },
);

app.post(
  "/v1/jobs/:id/change-orders",
  { preHandler: authenticate },
  async (request, reply) => {
    requireRole(actor(request), "TECHNICIAN");
    const jobId = parse(z.object({ id: uuid }), request.params).id;
    const body = parse(changeOrderSchema, request.body);

    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          status: jobs.status,
          technician_user_id: technicians.userId,
          customer_id: serviceRequests.customerId,
        })
        .from(jobs)
        .innerJoin(technicians, eq(technicians.id, jobs.technicianId))
        .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
        .where(eq(jobs.id, jobId))
        .for("update", { of: jobs });

      if (!row) throw new Error("NOT_FOUND");
      if (row.technician_user_id !== actor(request).id)
        throw new Error("FORBIDDEN");
      if (row.status !== "WORK_IN_PROGRESS")
        throw new Error("CHANGE_ORDER_NOT_ALLOWED");

      const [open] = await tx
        .select({ id: changeOrders.id })
        .from(changeOrders)
        .where(
          and(
            eq(changeOrders.jobId, jobId),
            eq(changeOrders.status, "SUBMITTED"),
          ),
        )
        .limit(1);

      if (open) throw new Error("CHANGE_ORDER_ALREADY_PENDING");

      const totals = quoteTotals(
        body.items,
        body.platformFeeCents,
        0,
        body.taxCents,
      );

      const [versionRow] = await tx
        .select({
          version: sql<number>`COALESCE(MAX(${changeOrders.version}),0)+1`,
        })
        .from(changeOrders)
        .where(eq(changeOrders.jobId, jobId));

      const version = Number(versionRow?.version ?? 1);

      const [created] = await tx
        .insert(changeOrders)
        .values({
          jobId,
          version,
          status: "SUBMITTED",
          reason: body.reason,
          explanation: body.explanation,
          attachmentKeys: body.attachmentKeys,
          contractorSubtotalCents: totals.contractorSubtotalCents,
          platformFeeCents: body.platformFeeCents,
          taxCents: body.taxCents,
          customerTotalCents: totals.customerTotalCents,
          expiresAt: new Date(body.expiresAt),
        })
        .returning({ id: changeOrders.id });

      const changeOrderId = created?.id;
      if (!changeOrderId) throw new Error("INSERT_FAILED");

      for (const [index, item] of body.items.entries()) {
        const subtotal = totals.itemSubtotals[index];
        if (subtotal === undefined) throw new Error("QUOTE_CALCULATION_FAILED");
        await tx.insert(changeOrderItems).values({
          changeOrderId,
          type: item.type,
          title: item.title,
          description: item.description ?? null,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          subtotalCents: subtotal,
          materialMetadata: item.materialMetadata ? (item.materialMetadata as any) : null,
        });
      }

      await tx
        .update(jobs)
        .set({ status: "CHANGE_ORDER_PENDING", updatedAt: new Date() })
        .where(eq(jobs.id, jobId));

      const [jobRecord] = await tx
        .select({ serviceRequestId: jobs.serviceRequestId })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (jobRecord) {
        await tx
          .update(serviceRequests)
          .set({ status: "CHANGE_ORDER_PENDING", updatedAt: new Date() })
          .where(eq(serviceRequests.id, jobRecord.serviceRequestId));
      }

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
    const result = await db
      .select({
        customer_id: serviceRequests.customerId,
        technician_user_id: technicians.userId,
        contractor_id: jobs.contractorId,
        id: changeOrders.id,
        status: changeOrders.status,
        customer_total_cents: changeOrders.customerTotalCents,
        items: sql<unknown>`COALESCE(json_agg(json_build_object('type',${changeOrderItems.type},'title',${changeOrderItems.title},'quantity',${changeOrderItems.quantity},'unitPriceCents',${changeOrderItems.unitPriceCents},'subtotalCents',${changeOrderItems.subtotalCents})) FILTER(WHERE ${changeOrderItems.id} IS NOT NULL),'[]')`,
      })
      .from(jobs)
      .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
      .innerJoin(technicians, eq(technicians.id, jobs.technicianId))
      .innerJoin(changeOrders, eq(changeOrders.jobId, jobs.id))
      .leftJoin(changeOrderItems, eq(changeOrderItems.changeOrderId, changeOrders.id))
      .where(eq(jobs.id, jobId))
      .groupBy(
        serviceRequests.customerId,
        technicians.userId,
        jobs.contractorId,
        changeOrders.id,
      );

    const first = result[0];
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
    return result;
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

    const response = await db.transaction(async (tx) => {
      const requestHash = `change-order:${changeOrderId}`;
      const [duplicate] = await tx
        .select({
          actor_id: idempotencyKeys.actorId,
          request_hash: idempotencyKeys.requestHash,
          response: idempotencyKeys.response,
        })
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, idempotencyKey))
        .limit(1);

      if (
        duplicate &&
        (duplicate.actor_id !== actor(request).id ||
          duplicate.request_hash !== requestHash)
      )
        throw new Error("IDEMPOTENCY_KEY_REUSED");
      if (duplicate?.response)
        return duplicate.response as {
          changeOrderId: string;
          milestoneId: string;
        };

      await tx.insert(idempotencyKeys).values({
        key: idempotencyKey,
        actorId: actor(request).id,
        requestHash,
      });

      const [row] = await tx
        .select({
          job_id: changeOrders.jobId,
          customer_id: serviceRequests.customerId,
          status: changeOrders.status,
          expires_at: changeOrders.expiresAt,
          customer_total_cents: changeOrders.customerTotalCents,
        })
        .from(changeOrders)
        .innerJoin(jobs, eq(jobs.id, changeOrders.jobId))
        .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
        .where(eq(changeOrders.id, changeOrderId))
        .for("update", { of: changeOrders });

      if (!row) throw new Error("NOT_FOUND");
      if (row.customer_id !== actor(request).id) throw new Error("FORBIDDEN");
      if (
        row.status !== "SUBMITTED" ||
        (row.expires_at && row.expires_at <= new Date())
      )
        throw new Error("CHANGE_ORDER_UNAVAILABLE");

      const [schedule] = await tx
        .select({ id: paymentSchedules.id })
        .from(paymentSchedules)
        .innerJoin(quotes, eq(quotes.id, paymentSchedules.quoteId))
        .where(
          and(eq(quotes.jobId, row.job_id), eq(quotes.status, "ACCEPTED")),
        )
        .for("update", { of: paymentSchedules });

      const scheduleId = schedule?.id;
      if (!scheduleId) throw new Error("MISSING_PAYMENT_SCHEDULE");

      const [nextRow] = await tx
        .select({
          sequence: sql<number>`COALESCE(MAX(${paymentMilestones.sequence}),0)+1`,
        })
        .from(paymentMilestones)
        .where(eq(paymentMilestones.scheduleId, scheduleId));

      const sequence = Number(nextRow?.sequence ?? 1);

      const [milestone] = await tx
        .insert(paymentMilestones)
        .values({
          scheduleId,
          sequence,
          triggerName: "CHANGE_ORDER_ACCEPTED",
          amountCents: Number(row.customer_total_cents),
          evidenceRequired: false,
        })
        .returning({ id: paymentMilestones.id });

      const milestoneId = milestone?.id;
      if (!milestoneId) throw new Error("INSERT_FAILED");

      await tx
        .update(changeOrders)
        .set({
          status: "ACCEPTED",
          acceptedAt: new Date(),
          acceptedBy: actor(request).id,
        })
        .where(eq(changeOrders.id, changeOrderId));

      await tx
        .update(jobs)
        .set({ status: "WORK_IN_PROGRESS", updatedAt: new Date() })
        .where(eq(jobs.id, row.job_id));

      const [jobRecord] = await tx
        .select({ serviceRequestId: jobs.serviceRequestId })
        .from(jobs)
        .where(eq(jobs.id, row.job_id))
        .limit(1);

      if (jobRecord) {
        await tx
          .update(serviceRequests)
          .set({ status: "WORK_IN_PROGRESS", updatedAt: new Date() })
          .where(eq(serviceRequests.id, jobRecord.serviceRequestId));
      }

      const output = { changeOrderId, milestoneId };
      await tx
        .update(idempotencyKeys)
        .set({ response: output })
        .where(eq(idempotencyKeys.key, idempotencyKey));

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

    const [changed] = await db
      .select({
        job_id: changeOrders.jobId,
        customer_id: serviceRequests.customerId,
        status: changeOrders.status,
      })
      .from(changeOrders)
      .innerJoin(jobs, eq(jobs.id, changeOrders.jobId))
      .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
      .where(
        and(
          eq(changeOrders.id, changeOrderId),
          eq(serviceRequests.customerId, actor(request).id),
          eq(changeOrders.status, "SUBMITTED"),
        ),
      )
      .limit(1);

    if (!changed)
      return reply
        .code(409)
        .send({
          code: "CHANGE_ORDER_UNAVAILABLE",
          message: "Change order cannot be declined",
        });

    await db
      .update(changeOrders)
      .set({ status: "DECLINED" })
      .where(eq(changeOrders.id, changeOrderId));

    const jobId = changed.job_id;
    await db
      .update(jobs)
      .set({ status: "WORK_IN_PROGRESS" })
      .where(eq(jobs.id, jobId));

    const [jobRecord] = await db
      .select({ serviceRequestId: jobs.serviceRequestId })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);

    if (jobRecord) {
      await db
        .update(serviceRequests)
        .set({ status: "WORK_IN_PROGRESS" })
        .where(eq(serviceRequests.id, jobRecord.serviceRequestId));
    }

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
    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          customer_id: serviceRequests.customerId,
          contractor_id: jobs.contractorId,
          status: jobs.status,
        })
        .from(jobs)
        .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
        .where(eq(jobs.id, jobId))
        .for("update", { of: jobs });

      if (!row) throw new Error("NOT_FOUND");
      if (
        !isOps(actor(request)) &&
        row.customer_id !== actor(request).id &&
        row.contractor_id !== actor(request).contractorId
      )
        throw new Error("FORBIDDEN");
      if (!["COMPLETED", "CLOSED"].includes(row.status))
        throw new Error("JOB_NOT_COMPLETE");

      const [existing] = await tx
        .select({
          id: invoices.id,
          invoice_number: invoices.invoiceNumber,
          total_cents: invoices.totalCents,
        })
        .from(invoices)
        .where(eq(invoices.jobId, jobId))
        .limit(1);

      if (existing) return existing;

      const [quote] = await tx
        .select()
        .from(quotes)
        .where(and(eq(quotes.jobId, jobId), eq(quotes.status, "ACCEPTED")))
        .limit(1);

      if (!quote) throw new Error("FINAL_PAYMENT_REQUIRED");

      const [coSum] = await tx
        .select({
          custTotal: sql<number>`COALESCE(sum(${changeOrders.customerTotalCents}),0)`,
          subtotal: sql<number>`COALESCE(sum(${changeOrders.contractorSubtotalCents}),0)`,
          fee: sql<number>`COALESCE(sum(${changeOrders.platformFeeCents}),0)`,
          tax: sql<number>`COALESCE(sum(${changeOrders.taxCents}),0)`,
        })
        .from(changeOrders)
        .where(
          and(
            eq(changeOrders.jobId, jobId),
            eq(changeOrders.status, "ACCEPTED"),
          ),
        );

      const [paidSum] = await tx
        .select({
          paid: sql<number>`COALESCE(sum(${paymentMilestones.amountCents}),0)`,
        })
        .from(paymentMilestones)
        .innerJoin(
          paymentSchedules,
          eq(paymentSchedules.id, paymentMilestones.scheduleId),
        )
        .where(
          and(
            eq(paymentSchedules.quoteId, quote.id),
            eq(paymentMilestones.status, "PAID"),
          ),
        );

      const expectedCents =
        Number(quote.customerTotalCents) + Number(coSum?.custTotal ?? 0);
      const paidCents = Number(paidSum?.paid ?? 0);
      const subtotalCents =
        Number(quote.contractorSubtotalCents) + Number(coSum?.subtotal ?? 0);
      const feeCents =
        Number(quote.platformFeeCents) + Number(coSum?.fee ?? 0);
      const taxCents = Number(quote.taxCents) + Number(coSum?.tax ?? 0);

      if (expectedCents !== paidCents) throw new Error("FINAL_PAYMENT_REQUIRED");

      const invoiceNumber = `INV-${new Date().getUTCFullYear()}-${jobId.slice(0, 8).toUpperCase()}`;

      const [created] = await tx
        .insert(invoices)
        .values({
          jobId,
          invoiceNumber,
          subtotalCents,
          platformFeeCents: feeCents,
          taxCents,
          totalCents: expectedCents,
          currency: quote.currency,
        })
        .returning({
          id: invoices.id,
          invoice_number: invoices.invoiceNumber,
          total_cents: invoices.totalCents,
        });

      await tx
        .insert(payouts)
        .values({
          contractorId: row.contractor_id,
          jobId,
          amountCents: subtotalCents,
          currency: quote.currency,
          status: "HELD",
          eligibleAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        })
        .onConflictDoNothing({ target: [payouts.contractorId, payouts.jobId] });

      return created;
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
    const records = await db
      .select({
        customer_id: properties.customerId,
        id: serviceRecords.id,
        vertical: verticals.name,
        summary: serviceRecords.summary,
        equipment: serviceRecords.equipment,
        completed_at: serviceRecords.completedAt,
      })
      .from(serviceRecords)
      .innerJoin(properties, eq(properties.id, serviceRecords.propertyId))
      .innerJoin(verticals, eq(verticals.id, serviceRecords.verticalId))
      .where(eq(serviceRecords.propertyId, propertyId))
      .orderBy(desc(serviceRecords.completedAt));

    if (
      records[0] &&
      records[0].customer_id !== actor(request).id &&
      !isOps(actor(request))
    )
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: "Not permitted" });
    return records;
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
    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          property_id: serviceRequests.propertyId,
          vertical_id: serviceRequests.verticalId,
          category_id: serviceRequests.categoryId,
          issue_type_id: serviceRequests.issueTypeId,
          customer_id: serviceRequests.customerId,
          description: serviceRequests.description,
        })
        .from(serviceRecords)
        .innerJoin(jobs, eq(jobs.id, serviceRecords.jobId))
        .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
        .where(eq(serviceRecords.id, recordId))
        .for("update", { of: serviceRecords });

      if (!row) throw new Error("NOT_FOUND");
      if (row.customer_id !== actor(request).id) throw new Error("FORBIDDEN");

      const [created] = await tx
        .insert(serviceRequests)
        .values({
          customerId: row.customer_id,
          propertyId: row.property_id,
          verticalId: row.vertical_id,
          categoryId: row.category_id,
          issueTypeId: row.issue_type_id,
          urgency: "STANDARD",
          status: "SUBMITTED",
          description: `Rebook: ${row.description}`,
          preferredStartsAt: new Date(body.preferredStartsAt),
          preferredEndsAt: new Date(body.preferredEndsAt),
        })
        .returning({ id: serviceRequests.id });

      return created;
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
    await db
      .select({
        id: notifications.id,
        event_type: notifications.eventType,
        title: notifications.title,
        body: notifications.body,
        payload: notifications.payload,
        read_at: notifications.readAt,
        created_at: notifications.createdAt,
      })
      .from(notifications)
      .where(eq(notifications.recipientUserId, actor(request).id))
      .orderBy(desc(notifications.createdAt))
      .limit(100),
);

app.post(
  "/v1/support-tickets",
  { preHandler: authenticate },
  async (request, reply) => {
    const body = parse(supportTicketSchema, request.body);
    let linked: { customer_id: string; contractor_id: string } | undefined;
    if (body.jobId) {
      const [job] = await db
        .select({
          customer_id: serviceRequests.customerId,
          contractor_id: jobs.contractorId,
        })
        .from(jobs)
        .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
        .where(eq(jobs.id, body.jobId))
        .limit(1);
      linked = job;
    }

    if (
      body.jobId &&
      (!linked ||
        (linked.customer_id !== actor(request).id && !isOps(actor(request))))
    )
      return reply
        .code(403)
        .send({ code: "FORBIDDEN", message: "Not permitted" });

    const [ticket] = await db
      .insert(supportTickets)
      .values({
        customerId: hasRole(actor(request), "CUSTOMER") ? actor(request).id : null,
        contractorId: linked?.contractor_id ?? null,
        jobId: body.jobId ?? null,
        subject: body.subject,
        description: body.description,
      })
      .returning({ id: supportTickets.id });

    const ticketId = ticket?.id;
    if (!ticketId) throw new Error("INSERT_FAILED");

    let disputeId: string | undefined;
    if (body.dispute && body.jobId && linked && linked.contractor_id && hasRole(actor(request), "CUSTOMER")) {
      const [dispute] = await db
        .insert(disputes)
        .values({
          supportTicketId: ticketId,
          jobId: body.jobId,
          customerId: actor(request).id,
          contractorId: linked.contractor_id,
        })
        .returning({ id: disputes.id });

      disputeId = dispute?.id;
      if (disputeId && body.evidenceKeys) {
        for (const key of body.evidenceKeys) {
          await db.insert(disputeEvidence).values({
            disputeId,
            submittedBy: actor(request).id,
            attachmentKey: key,
          });
        }
      }
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

    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          id: disputes.id,
          job_id: disputes.jobId,
          support_ticket_id: disputes.supportTicketId,
          customer_id: disputes.customerId,
          contractor_id: disputes.contractorId,
          status: disputes.status,
        })
        .from(disputes)
        .where(eq(disputes.id, disputeId))
        .for("update", { of: disputes });

      if (!row) throw new Error("NOT_FOUND");
      if (row.status === "RESOLVED" || row.status === "CLOSED")
        return reply
          .code(409)
          .send({
            code: "DISPUTE_ALREADY_RESOLVED",
            message: "Dispute already resolved",
          });

      const [payoutRow] = await tx
        .select({
          id: payouts.id,
          amount_cents: payouts.amountCents,
          status: payouts.status,
        })
        .from(payouts)
        .where(eq(payouts.jobId, row.job_id))
        .for("update", { of: payouts });

      const totalPayoutCents = payoutRow ? Number(payoutRow.amount_cents) : 0;
      let refundDecisionCents = 0;

      if (body.resolution === "RELEASE_TO_CONTRACTOR") {
        if (payoutRow) {
          await tx
            .update(payouts)
            .set({ status: "ELIGIBLE", eligibleAt: new Date() })
            .where(eq(payouts.id, payoutRow.id));
        }
      } else if (body.resolution === "REFUND_TO_CUSTOMER") {
        refundDecisionCents = body.refundCents ?? totalPayoutCents;
        if (payoutRow) {
          await tx
            .update(payouts)
            .set({ status: "REVERSED" })
            .where(eq(payouts.id, payoutRow.id));
        }
      } else if (body.resolution === "SPLIT_EQUAL") {
        const half = Math.floor(totalPayoutCents / 2);
        refundDecisionCents = half;
        if (payoutRow) {
          await tx
            .update(payouts)
            .set({
              amountCents: totalPayoutCents - half,
              status: "ELIGIBLE",
              eligibleAt: new Date(),
            })
            .where(eq(payouts.id, payoutRow.id));
        }
      }

      await tx
        .update(disputes)
        .set({
          status: "RESOLVED",
          resolution: `${body.resolution}: ${body.notes}`,
          refundDecisionCents,
          resolvedBy: actor(request).id,
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(disputes.id, disputeId));

      await tx
        .update(supportTickets)
        .set({ status: "RESOLVED", closedAt: new Date(), updatedAt: new Date() })
        .where(eq(supportTickets.id, row.support_ticket_id));

      await tx
        .update(jobs)
        .set({ status: "CLOSED", updatedAt: new Date() })
        .where(eq(jobs.id, row.job_id));

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

    const [transactionRow] = await db
      .select({
        amount_cents: paymentTransactions.amountCents,
        status: paymentTransactions.status,
        refunded_cents: sql<number>`COALESCE(sum(${refunds.amountCents}) FILTER (WHERE ${refunds.status}='REFUNDED'),0)`,
      })
      .from(paymentTransactions)
      .leftJoin(refunds, eq(refunds.transactionId, paymentTransactions.id))
      .where(eq(paymentTransactions.id, body.transactionId))
      .groupBy(paymentTransactions.id);

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

    const [result] = await db
      .insert(refunds)
      .values({
        transactionId: body.transactionId,
        amountCents: body.amountCents,
        reason: body.reason,
        status: "REFUNDED",
        idempotencyKey: body.idempotencyKey,
        createdBy: actor(request).id,
      })
      .onConflictDoNothing({ target: refunds.idempotencyKey })
      .returning({ id: refunds.id });

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
      .send({ refundId: result?.id, status: "REFUNDED" });
  },
);

app.setErrorHandler((error, request, reply) => {
  const message =
    error instanceof Error ? error.message : "Unknown request error";
  const code =
    error instanceof z.ZodError
      ? "VALIDATION_ERROR"
      : (error as any).code === "REGULATORY_ELIGIBILITY_FAILED"
        ? "REGULATORY_ELIGIBILITY_FAILED"
        : message === "FORBIDDEN"
          ? "FORBIDDEN"
          : message === "NOT_FOUND"
            ? "NOT_FOUND"
            : "REQUEST_FAILED";
  const status =
    (error as any).statusCode ??
    (code === "VALIDATION_ERROR"
      ? 400
      : code === "FORBIDDEN"
        ? 403
        : code === "NOT_FOUND"
          ? 404
          : 409);
  request.log.warn({ error, requestId: request.id }, "request failed");
  return reply
    .code(status)
    .send({
      code,
      message:
        code === "REQUEST_FAILED"
          ? "The operation could not be completed"
          : message,
      ...((error as any).details ? { details: (error as any).details } : {}),
      requestId: request.id,
    });
});

export { app };

if (process.env.API_NO_LISTEN !== "true")
  await app.listen({
    port: Number(process.env.API_PORT ?? 4000),
    host: "0.0.0.0",
  });
