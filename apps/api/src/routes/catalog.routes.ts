import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireRole } from "@marketplace/auth";
import type { RiskTier } from "@marketplace/contracts";
import {
  db,
  eq,
  and,
  asc,
  verticals,
  serviceCategories,
  issueTypes,
} from "@marketplace/database";
import {
  CANONICAL_TRADE_CATALOG,
  searchCatalog,
} from "@marketplace/vertical-engine";
import { actor, authenticate, parse, uuid } from "../common/auth.js";
import { audit } from "../common/events.js";

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
    family: z
      .enum([
        "MECHANICAL",
        "STRUCTURAL",
        "SURFACE_FINISHES",
        "SPECIALTY",
        "OUTDOOR_SITE",
      ])
      .optional(),
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

export const catalogRoutes: FastifyPluginAsync = async (app) => {
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
      family: z
        .enum([
          "MECHANICAL",
          "STRUCTURAL",
          "SURFACE_FINISHES",
          "SPECIALTY",
          "OUTDOOR_SITE",
        ])
        .optional(),
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
      .innerJoin(
        serviceCategories,
        eq(serviceCategories.id, issueTypes.categoryId),
      )
      .innerJoin(verticals, eq(verticals.id, serviceCategories.verticalId))
      .where(and(...searchWhere))
      .orderBy(
        asc(verticals.displayOrder),
        asc(serviceCategories.displayOrder),
        asc(issueTypes.displayOrder),
      );

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
            if (row.variant_name.toLowerCase().includes(token))
              matchScore += 50;
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
      family: z
        .enum([
          "MECHANICAL",
          "STRUCTURAL",
          "SURFACE_FINISHES",
          "SPECIALTY",
          "OUTDOOR_SITE",
        ])
        .optional(),
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
      .orderBy(
        asc(serviceCategories.displayOrder),
        asc(serviceCategories.name),
      );

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
      .innerJoin(
        serviceCategories,
        eq(serviceCategories.id, issueTypes.categoryId),
      )
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
      if (body.description !== undefined)
        updateValues.description = body.description;
      if (body.icon !== undefined) updateValues.icon = body.icon;
      if (body.riskTier !== undefined) updateValues.riskTier = body.riskTier;
      if (body.permitAuthority !== undefined)
        updateValues.permitAuthority = body.permitAuthority;
      if (body.launchReady !== undefined)
        updateValues.launchReady = body.launchReady;
      if (body.displayOrder !== undefined)
        updateValues.displayOrder = body.displayOrder;
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
      if (body.description !== undefined)
        updateValues.description = body.description;
      if (body.riskTier !== undefined) updateValues.riskTier = body.riskTier;
      if (body.launchReady !== undefined)
        updateValues.launchReady = body.launchReady;
      if (body.displayOrder !== undefined)
        updateValues.displayOrder = body.displayOrder;

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
      if (body.description !== undefined)
        updateValues.description = body.description;
      if (body.scopeSummary !== undefined)
        updateValues.scopeSummary = body.scopeSummary;
      if (body.riskTier !== undefined) updateValues.riskTier = body.riskTier;
      if (body.pricingType !== undefined)
        updateValues.pricingType = body.pricingType;
      if (body.basePriceCents !== undefined)
        updateValues.basePriceCents = body.basePriceCents;
      if (body.defaultDurationMinutes !== undefined)
        updateValues.defaultDurationMinutes = body.defaultDurationMinutes;
      if (body.requiresPermit !== undefined)
        updateValues.requiresPermit = body.requiresPermit;
      if (body.permitType !== undefined)
        updateValues.permitType = body.permitType;
      if (body.requiredEvidence !== undefined)
        updateValues.requiredEvidence = body.requiredEvidence;
      if (body.defaultWarrantyMonths !== undefined)
        updateValues.defaultWarrantyMonths = body.defaultWarrantyMonths;
      if (body.geographicRestrictions !== undefined)
        updateValues.geographicRestrictions = body.geographicRestrictions;
      if (body.tags !== undefined) updateValues.tags = body.tags;
      if (body.launchReady !== undefined)
        updateValues.launchReady = body.launchReady;
      if (body.displayOrder !== undefined)
        updateValues.displayOrder = body.displayOrder;

      await db
        .update(issueTypes)
        .set(updateValues)
        .where(eq(issueTypes.id, id));
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
};
