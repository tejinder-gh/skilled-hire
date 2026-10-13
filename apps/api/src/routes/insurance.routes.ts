import type { FastifyPluginAsync } from "fastify";
import { requireRole } from "@marketplace/auth";
import type {
  ProtectionCertificate,
  ProtectionClaim,
  ProtectionLedgerEntry,
  ProtectionPolicy,
  ProtectionProduct,
  ProtectionQuote,
} from "@marketplace/contracts";
import {
  db,
  eq,
  and,
  desc,
  customerProtectionProducts,
  protectionQuotes,
  protectionPolicies,
  protectionClaims,
  protectionFinancialLedger,
  serviceRequests,
  contractors,
  properties,
  users,
  jobs,
} from "@marketplace/database";
import {
  createProtectionProductSchema,
  quoteProtectionSchema,
  bindProtectionPolicySchema,
  cancelProtectionPolicySchema,
  createProtectionClaimSchema,
  adjudicateProtectionClaimSchema,
  queryProtectionReconciliationSchema,
  uuid,
} from "@marketplace/validation";
import {
  evaluateCoverageEligibility,
  calculateProtectionPremium,
  buildCoverageCertificate,
  verifyCoverageCertificate,
  adjudicateProtectionClaim,
} from "@marketplace/vertical-engine";
import { z } from "zod";
import { actor, authenticate, isOps, parse } from "../common/auth.js";
import { audit } from "../common/events.js";

function toProductContract(
  row: typeof customerProtectionProducts.$inferSelect,
): ProtectionProduct {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    version: row.version,
    jurisdiction: row.jurisdiction,
    underwriterName: row.underwriterName,
    underwriterPolicyRef: row.underwriterPolicyRef,
    brokerName: row.brokerName,
    brokerLicenseRef: row.brokerLicenseRef,
    coverageLimitCents: Number(row.coverageLimitCents),
    deductibleCents: Number(row.deductibleCents),
    durationMonths: row.durationMonths,
    baseRateBps: row.baseRateBps,
    minPremiumCents: Number(row.minPremiumCents),
    brokerCommissionBps: row.brokerCommissionBps,
    platformFeeBps: row.platformFeeBps,
    taxRateBps: row.taxRateBps,
    termsMarkdown: row.termsMarkdown,
    disclaimers: (row.disclaimers as string[]) ?? [],
    maxJobValueCents: Number(row.maxJobValueCents),
    active: row.active,
  };
}

function toQuoteContract(
  row: typeof protectionQuotes.$inferSelect,
): ProtectionQuote {
  return {
    id: row.id,
    serviceRequestId: row.serviceRequestId,
    productId: row.productId,
    jobValueCents: Number(row.jobValueCents),
    coverageLimitCents: Number(row.coverageLimitCents),
    deductibleCents: Number(row.deductibleCents),
    grossPremiumCents: Number(row.grossPremiumCents),
    brokerCommissionCents: Number(row.brokerCommissionCents),
    platformFeeCents: Number(row.platformFeeCents),
    taxCents: Number(row.taxCents),
    totalPayableCents: Number(row.totalPayableCents),
    eligible: row.eligible,
    underwritingDecision: row.underwritingDecision,
    declineReasons: (row.declineReasons as string[]) ?? [],
    expiresAt: row.expiresAt.toISOString(),
    status: row.status as ProtectionQuote["status"],
    createdAt: row.createdAt.toISOString(),
  };
}

function toPolicyContract(
  row: typeof protectionPolicies.$inferSelect,
): ProtectionPolicy {
  return {
    id: row.id,
    certificateNumber: row.certificateNumber,
    serviceRequestId: row.serviceRequestId,
    jobId: row.jobId ?? null,
    productId: row.productId,
    quoteId: row.quoteId,
    customerId: row.customerId,
    contractorId: row.contractorId,
    status: row.status as ProtectionPolicy["status"],
    coverageLimitCents: Number(row.coverageLimitCents),
    deductibleCents: Number(row.deductibleCents),
    grossPremiumCents: Number(row.grossPremiumCents),
    taxCents: Number(row.taxCents),
    totalPaidCents: Number(row.totalPaidCents),
    effectiveStartDate: row.effectiveStartDate.toISOString(),
    effectiveEndDate: row.effectiveEndDate.toISOString(),
    cancellationDeadline: row.cancellationDeadline.toISOString(),
    policyChecksum: row.policyChecksum,
    underwriterPolicyRef: row.underwriterPolicyRef,
    brokerLicenseRef: row.brokerLicenseRef,
    bindingEvidenceSnapshot: (row.bindingEvidenceSnapshot as any) ?? {},
    createdAt: row.createdAt.toISOString(),
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    cancellationReason: row.cancellationReason ?? null,
  };
}

function toClaimContract(
  row: typeof protectionClaims.$inferSelect,
): ProtectionClaim {
  return {
    id: row.id,
    claimNumber: row.claimNumber,
    policyId: row.policyId,
    serviceRequestId: row.serviceRequestId,
    claimantUserId: row.claimantUserId,
    contractorId: row.contractorId,
    incidentDate: row.incidentDate.toISOString(),
    incidentDescription: row.incidentDescription,
    claimedAmountCents: Number(row.claimedAmountCents),
    evidenceUrls: (row.evidenceUrls as string[]) ?? [],
    status: row.status as ProtectionClaim["status"],
    adjudicatedAmountCents: Number(row.adjudicatedAmountCents ?? 0),
    deductibleAppliedCents: Number(row.deductibleAppliedCents ?? 0),
    netPayoutCents: Number(row.netPayoutCents ?? 0),
    adjudicationNotes: row.adjudicationNotes ?? null,
    adjudicatedByUserId: row.adjudicatedByUserId ?? null,
    adjudicatedAt: row.adjudicatedAt ? row.adjudicatedAt.toISOString() : null,
    paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    declineReasonCode: row.declineReasonCode ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export const insuranceRoutes: FastifyPluginAsync = async (app) => {
  // 1. Discover Active Approved Protection Products
  app.get("/v1/protection/products", async (request, reply) => {
    const query = parse(
      z.object({
        jurisdiction: z.string().default("ON"),
        active: z.coerce.boolean().default(true),
      }),
      request.query,
    );

    const jurisdiction = query.jurisdiction ?? "ON";
    const active = query.active ?? true;

    const rows = await db
      .select()
      .from(customerProtectionProducts)
      .where(
        and(
          eq(customerProtectionProducts.jurisdiction, jurisdiction),
          eq(customerProtectionProducts.active, active),
        ),
      )
      .orderBy(customerProtectionProducts.coverageLimitCents);

    return reply.code(200).send({
      products: rows.map(toProductContract),
      jurisdiction,
      statutoryDisclosures: [
        "Skilled Hire Inc. operates as a technology intermediary; insurance products are distributed strictly through SkilledHire Insurance Services Inc. (RIBO #39102).",
        "Underwritten by licensed Canadian general insurer Trillium Surety & Casualty Canada ULC.",
        "Optional coverage. No unsupported 100% guarantee language. 10-day statutory cooling-off cancellation rights with full premium refund.",
      ],
    });
  });

  // 2. Admin Creates / Publishes Protection Product
  app.post(
    "/v1/protection/products",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      requireRole(user, "ADMIN", "SUPER_ADMIN");
      const body = parse(createProtectionProductSchema, request.body);

      const [inserted] = await db
        .insert(customerProtectionProducts)
        .values({
          slug: body.slug,
          name: body.name,
          version: body.version,
          jurisdiction: body.jurisdiction,
          underwriterName: body.underwriterName,
          underwriterPolicyRef: body.underwriterPolicyRef,
          brokerName: body.brokerName,
          brokerLicenseRef: body.brokerLicenseRef,
          coverageLimitCents: body.coverageLimitCents,
          deductibleCents: body.deductibleCents,
          durationMonths: body.durationMonths,
          baseRateBps: body.baseRateBps,
          minPremiumCents: body.minPremiumCents,
          brokerCommissionBps: body.brokerCommissionBps,
          platformFeeBps: body.platformFeeBps,
          taxRateBps: body.taxRateBps,
          termsMarkdown: body.termsMarkdown,
          disclaimers: body.disclaimers,
          allowedVerticalIds: body.allowedVerticalIds,
          maxJobValueCents: body.maxJobValueCents,
          active: body.active,
        })
        .returning();

      await audit(
        user.id,
        "PROTECTION_PRODUCT_PUBLISHED",
        "PROTECTION_PRODUCT",
        inserted!.id,
        null,
        inserted,
      );

      return reply.code(201).send({ product: toProductContract(inserted!) });
    },
  );

  // 3. Generate Underwriting Quote for Service Request
  app.post(
    "/v1/protection/quotes",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const body = parse(quoteProtectionSchema, request.body);

      // Verify Service Request
      const [sr] = await db
        .select({
          id: serviceRequests.id,
          customerId: serviceRequests.customerId,
          verticalId: serviceRequests.verticalId,
          region: properties.region,
          urgency: serviceRequests.urgency,
        })
        .from(serviceRequests)
        .innerJoin(properties, eq(properties.id, serviceRequests.propertyId))
        .where(eq(serviceRequests.id, body.serviceRequestId))
        .limit(1);

      if (!sr) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Service request not found",
        });
      }

      if (sr.customerId !== user.id && !isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "You are not authorized to quote protection for this request",
        });
      }

      // Find Product
      let productRow: typeof customerProtectionProducts.$inferSelect | undefined;
      if (body.productId) {
        const [p] = await db
          .select()
          .from(customerProtectionProducts)
          .where(eq(customerProtectionProducts.id, body.productId))
          .limit(1);
        productRow = p;
      } else if (body.productSlug) {
        const [p] = await db
          .select()
          .from(customerProtectionProducts)
          .where(
            and(
              eq(customerProtectionProducts.slug, body.productSlug),
              eq(customerProtectionProducts.active, true),
            ),
          )
          .limit(1);
        productRow = p;
      } else {
        const [p] = await db
          .select()
          .from(customerProtectionProducts)
          .where(
            and(
              eq(customerProtectionProducts.slug, "STANDARD_DEFECT_PROTECTION"),
              eq(customerProtectionProducts.active, true),
            ),
          )
          .limit(1);
        productRow = p;
      }

      if (!productRow) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Protection product not found",
        });
      }

      const product = toProductContract(productRow);
      const jobValue = body.jobValueCents ?? 250000; // default $2,500.00 if unestimated

      // Locate assigned contractor if any
      const [existingJob] = await db
        .select({
          contractorId: jobs.contractorId,
        })
        .from(jobs)
        .where(eq(jobs.serviceRequestId, sr.id))
        .limit(1);

      let contractorInput: any = undefined;
      if (existingJob?.contractorId) {
        const [c] = await db
          .select({
            id: contractors.id,
            status: contractors.status,
            safetyStatus: contractors.safetyStatus,
          })
          .from(contractors)
          .where(eq(contractors.id, existingJob.contractorId))
          .limit(1);
        contractorInput = c;
      }

      // Run Underwriting Engine
      const eligibility = evaluateCoverageEligibility({
        product,
        jobValueCents: jobValue,
        serviceRequest: {
          id: sr.id,
          verticalId: sr.verticalId,
          region: sr.region,
          urgency: sr.urgency,
        },
        contractor: contractorInput,
      });

      const pricing = calculateProtectionPremium({
        product,
        jobValueCents: jobValue,
      });

      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days valid quote

      const [quoteRow] = await db
        .insert(protectionQuotes)
        .values({
          serviceRequestId: sr.id,
          productId: product.id,
          jobValueCents: jobValue,
          coverageLimitCents: product.coverageLimitCents,
          deductibleCents: product.deductibleCents,
          grossPremiumCents: pricing.grossPremiumCents,
          brokerCommissionCents: pricing.brokerCommissionCents,
          platformFeeCents: pricing.platformFeeCents,
          taxCents: pricing.taxCents,
          totalPayableCents: pricing.totalPayableCents,
          eligible: eligibility.eligible,
          underwritingDecision: eligibility.decision,
          declineReasons: eligibility.declineReasons,
          expiresAt,
          status: "ISSUED",
        })
        .returning();

      return reply.code(201).send({
        quote: toQuoteContract(quoteRow!),
        product: {
          name: product.name,
          underwriterName: product.underwriterName,
          brokerName: product.brokerName,
          brokerLicenseRef: product.brokerLicenseRef,
        },
      });
    },
  );

  // 4. Retrieve Quote by ID
  app.get(
    "/v1/protection/quotes/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const quoteId = parse(z.object({ id: uuid }), request.params).id;

      const [quoteRow] = await db
        .select()
        .from(protectionQuotes)
        .where(eq(protectionQuotes.id, quoteId))
        .limit(1);

      if (!quoteRow) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Quote not found",
        });
      }

      const [sr] = await db
        .select({ customerId: serviceRequests.customerId })
        .from(serviceRequests)
        .where(eq(serviceRequests.id, quoteRow.serviceRequestId))
        .limit(1);

      if (sr?.customerId !== user.id && !isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Not authorized to view this quote",
        });
      }

      return reply.code(200).send({ quote: toQuoteContract(quoteRow) });
    },
  );

  // 5. Bind Protection Policy & Issue Coverage Certificate
  app.post(
    "/v1/protection/policies/bind",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const body = parse(bindProtectionPolicySchema, request.body);

      const [quote] = await db
        .select()
        .from(protectionQuotes)
        .where(eq(protectionQuotes.id, body.quoteId))
        .limit(1);

      if (!quote) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Quote not found",
        });
      }

      if (!quote.eligible) {
        return reply.code(422).send({
          statusCode: 422,
          code: "UNDERWRITING_INELIGIBLE",
          message: `Cannot bind coverage: quote declined by underwriting (${quote.underwritingDecision})`,
          details: { declineReasons: quote.declineReasons },
        });
      }

      if (quote.status === "BOUND") {
        return reply.code(409).send({
          statusCode: 409,
          code: "ALREADY_BOUND",
          message: "Policy is already bound for this quote",
        });
      }

      if (new Date(quote.expiresAt).getTime() < Date.now()) {
        return reply.code(422).send({
          statusCode: 422,
          code: "QUOTE_EXPIRED",
          message: "Quote has expired. Please generate a fresh underwriting quote.",
        });
      }

      // Check customer privity
      const [sr] = await db
        .select({
          id: serviceRequests.id,
          customerId: serviceRequests.customerId,
          verticalId: serviceRequests.verticalId,
          region: properties.region,
        })
        .from(serviceRequests)
        .innerJoin(properties, eq(properties.id, serviceRequests.propertyId))
        .where(eq(serviceRequests.id, quote.serviceRequestId))
        .limit(1);

      if (!sr || (sr.customerId !== user.id && !isOps(user))) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Not authorized to bind policy for this service request",
        });
      }

      const [productRow] = await db
        .select()
        .from(customerProtectionProducts)
        .where(eq(customerProtectionProducts.id, quote.productId))
        .limit(1);

      if (!productRow) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Product not found",
        });
      }

      // Find contractor associated with job/request or default contractor
      const [jobRow] = await db
        .select({ id: jobs.id, contractorId: jobs.contractorId })
        .from(jobs)
        .where(eq(jobs.serviceRequestId, sr.id))
        .limit(1);

      let contractorId = jobRow?.contractorId;
      if (!contractorId) {
        const [firstCont] = await db
          .select({ id: contractors.id })
          .from(contractors)
          .where(eq(contractors.status, "VERIFIED"))
          .limit(1);
        contractorId = firstCont?.id;
      }

      if (!contractorId) {
        return reply.code(422).send({
          statusCode: 422,
          code: "CONTRACTOR_REQUIRED_FOR_BINDING",
          message: "A verified contractor is required to bind warranty coverage",
        });
      }

      const [contractorUser] = await db
        .select({ name: contractors.name, safetyStatus: contractors.safetyStatus })
        .from(contractors)
        .where(eq(contractors.id, contractorId))
        .limit(1);

      if (contractorUser?.safetyStatus === "SUSPENDED") {
        return reply.code(422).send({
          statusCode: 422,
          code: "CONTRACTOR_SAFETY_SUSPENDED",
          message: "Cannot bind coverage with suspended contractor",
        });
      }

      const [custRecord] = await db
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, sr.customerId))
        .limit(1);

      const now = new Date();
      now.setMilliseconds(0);
      const certificateNumber = `SH-POL-2026-ON-${Math.floor(100000 + Math.random() * 900000)}`;
      const policyId = crypto.randomUUID();
      const effectiveStart = now;
      const effectiveEnd = new Date(
        now.getTime() + productRow.durationMonths * 30 * 24 * 60 * 60 * 1000,
      );
      effectiveEnd.setMilliseconds(0);
      const cancellationDeadline = new Date(
        now.getTime() + 10 * 24 * 60 * 60 * 1000,
      ); // 10-day statutory cooling-off
      cancellationDeadline.setMilliseconds(0);

      // Cryptographically assemble certificate
      const certificate = buildCoverageCertificate({
        certificateNumber,
        policyId,
        jurisdiction: productRow.jurisdiction,
        customerId: sr.customerId,
        customerName: custRecord?.displayName ?? "Insured Customer",
        contractorId,
        contractorName: contractorUser?.name ?? "Licensed Contractor",
        underwriterName: productRow.underwriterName,
        underwriterPolicyRef: productRow.underwriterPolicyRef,
        brokerName: productRow.brokerName,
        brokerLicenseRef: productRow.brokerLicenseRef,
        coverageLimitCents: Number(quote.coverageLimitCents),
        deductibleCents: Number(quote.deductibleCents),
        durationMonths: productRow.durationMonths,
        effectiveStartDate: effectiveStart.toISOString(),
        effectiveEndDate: effectiveEnd.toISOString(),
        cancellationDeadline: cancellationDeadline.toISOString(),
      });

      // Atomic Transaction: update quote, insert policy, write ledger entries
      const policyRecord = await db.transaction(async (tx) => {
        await tx
          .update(protectionQuotes)
          .set({ status: "BOUND" })
          .where(eq(protectionQuotes.id, quote.id));

        const [policy] = await tx
          .insert(protectionPolicies)
          .values({
            id: policyId,
            certificateNumber,
            serviceRequestId: sr.id,
            jobId: jobRow?.id ?? null,
            productId: productRow.id,
            quoteId: quote.id,
            customerId: sr.customerId,
            contractorId,
            status: "BOUND_ACTIVE",
            coverageLimitCents: Number(quote.coverageLimitCents),
            deductibleCents: Number(quote.deductibleCents),
            grossPremiumCents: Number(quote.grossPremiumCents),
            taxCents: Number(quote.taxCents),
            totalPaidCents: Number(quote.totalPayableCents),
            effectiveStartDate: effectiveStart,
            effectiveEndDate: effectiveEnd,
            cancellationDeadline,
            policyChecksum: certificate.policyChecksum,
            underwriterPolicyRef: productRow.underwriterPolicyRef,
            brokerLicenseRef: productRow.brokerLicenseRef,
            bindingEvidenceSnapshot: {
              acknowledgedDisclosures: true,
              paymentMethodRef: body.paymentMethodRef ?? "CARD_ESCROW",
              certificateNumber,
              brokerLicence: productRow.brokerLicenseRef,
            },
          })
          .returning();

        // Financial Ledger Entries: Double-entry audit trail
        // 1. Gross Premium collected into Escrow
        await tx.insert(protectionFinancialLedger).values({
          transactionType: "PREMIUM_COLLECTION",
          policyId: policy!.id,
          amountCents: Number(quote.grossPremiumCents),
          currency: "CAD",
          direction: "CREDIT",
          sourceAccount: "CUSTOMER_PAYMENT",
          destinationAccount: "ESCROW_PROTECTION_RESERVE",
          reference: `BIND-PREM-${policy!.certificateNumber}`,
          metadata: { quoteId: quote.id },
        });

        // 2. Broker Commission payable
        await tx.insert(protectionFinancialLedger).values({
          transactionType: "BROKER_COMMISSION_PAYABLE",
          policyId: policy!.id,
          amountCents: Number(quote.brokerCommissionCents),
          currency: "CAD",
          direction: "CREDIT",
          sourceAccount: "ESCROW_PROTECTION_RESERVE",
          destinationAccount: "BROKER_COMMISSION_LEDGER",
          reference: `COMM-RIBO-${policy!.certificateNumber}`,
          metadata: { brokerLicenseRef: productRow.brokerLicenseRef },
        });

        // 3. Platform technology fee earned
        await tx.insert(protectionFinancialLedger).values({
          transactionType: "PLATFORM_FEE_EARNED",
          policyId: policy!.id,
          amountCents: Number(quote.platformFeeCents),
          currency: "CAD",
          direction: "CREDIT",
          sourceAccount: "CUSTOMER_PAYMENT",
          destinationAccount: "PLATFORM_REVENUE",
          reference: `FEE-TECH-${policy!.certificateNumber}`,
        });

        // 4. Insurer net premium allocated
        await tx.insert(protectionFinancialLedger).values({
          transactionType: "INSURER_PREMIUM_REMITTANCE",
          policyId: policy!.id,
          amountCents:
            Number(quote.grossPremiumCents) - Number(quote.brokerCommissionCents),
          currency: "CAD",
          direction: "CREDIT",
          sourceAccount: "ESCROW_PROTECTION_RESERVE",
          destinationAccount: "INSURER_UNDERWRITING_ACCOUNT",
          reference: `REMIT-UW-${policy!.certificateNumber}`,
          metadata: { underwriterPolicyRef: productRow.underwriterPolicyRef },
        });

        return policy!;
      });

      await audit(
        user.id,
        "PROTECTION_POLICY_BOUND",
        "PROTECTION_POLICY",
        policyRecord.id,
        null,
        policyRecord,
      );

      return reply.code(201).send({
        policy: toPolicyContract(policyRecord),
        certificate,
      });
    },
  );

  // 6. Query Policy by ID
  app.get(
    "/v1/protection/policies/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const policyId = parse(z.object({ id: uuid }), request.params).id;

      const [policy] = await db
        .select()
        .from(protectionPolicies)
        .where(eq(protectionPolicies.id, policyId))
        .limit(1);

      if (!policy) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Policy not found",
        });
      }

      if (policy.customerId !== user.id && !isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Tenant isolation: cannot access other users' protection policies",
        });
      }

      return reply.code(200).send({ policy: toPolicyContract(policy) });
    },
  );

  // 7. Get Coverage Certificate (Tamper-evident verification)
  app.get(
    "/v1/protection/policies/:id/certificate",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const policyId = parse(z.object({ id: uuid }), request.params).id;

      const [policy] = await db
        .select()
        .from(protectionPolicies)
        .where(eq(protectionPolicies.id, policyId))
        .limit(1);

      if (!policy) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Policy not found",
        });
      }

      if (policy.customerId !== user.id && !isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Tenant isolation: cannot access other users' protection certificates",
        });
      }

      const [cust] = await db
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, policy.customerId))
        .limit(1);

      const [cont] = await db
        .select({ name: contractors.name })
        .from(contractors)
        .where(eq(contractors.id, policy.contractorId))
        .limit(1);

      const [prod] = await db
        .select()
        .from(customerProtectionProducts)
        .where(eq(customerProtectionProducts.id, policy.productId))
        .limit(1);

      const certificate = buildCoverageCertificate({
        certificateNumber: policy.certificateNumber,
        policyId: policy.id,
        jurisdiction: prod?.jurisdiction ?? "ON",
        customerId: policy.customerId,
        customerName: cust?.displayName ?? "Insured Customer",
        contractorId: policy.contractorId,
        contractorName: cont?.name ?? "Licensed Contractor",
        underwriterName: prod?.underwriterName ?? "Trillium Surety & Casualty Canada ULC",
        underwriterPolicyRef: policy.underwriterPolicyRef,
        brokerName: prod?.brokerName ?? "SkilledHire Insurance Services Inc.",
        brokerLicenseRef: policy.brokerLicenseRef,
        coverageLimitCents: Number(policy.coverageLimitCents),
        deductibleCents: Number(policy.deductibleCents),
        durationMonths: prod?.durationMonths ?? 12,
        effectiveStartDate: policy.effectiveStartDate.toISOString(),
        effectiveEndDate: policy.effectiveEndDate.toISOString(),
        cancellationDeadline: policy.cancellationDeadline.toISOString(),
      });

      const checksumMatches = verifyCoverageCertificate(certificate);

      return reply.code(200).send({
        certificate,
        tamperEvident: {
          verified: checksumMatches,
          recordedChecksum: policy.policyChecksum,
          computedChecksum: certificate.policyChecksum,
        },
      });
    },
  );

  // 8. Statutory 10-Day Policy Cancellation & Full Refund
  app.post(
    "/v1/protection/policies/:id/cancel",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const policyId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(cancelProtectionPolicySchema, request.body);

      const [policy] = await db
        .select()
        .from(protectionPolicies)
        .where(eq(protectionPolicies.id, policyId))
        .limit(1);

      if (!policy) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Policy not found",
        });
      }

      if (policy.customerId !== user.id && !isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Not authorized to cancel this policy",
        });
      }

      if (policy.status !== "BOUND_ACTIVE") {
        return reply.code(422).send({
          statusCode: 422,
          code: "INVALID_POLICY_STATUS",
          message: `Cannot cancel policy with status '${policy.status}'`,
        });
      }

      if (Date.now() > new Date(policy.cancellationDeadline).getTime()) {
        return reply.code(422).send({
          statusCode: 422,
          code: "CANCELLATION_DEADLINE_EXCEEDED",
          message:
            "Statutory 10-day cooling-off cancellation period has expired. Policy is non-refundable.",
        });
      }

      // Atomic cancellation & financial ledger reversal
      const updated = await db.transaction(async (tx) => {
        const [cancelled] = await tx
          .update(protectionPolicies)
          .set({
            status: "CANCELLED_REFUNDED",
            cancelledAt: new Date(),
            cancellationReason: body.reason,
          })
          .where(eq(protectionPolicies.id, policy.id))
          .returning();

        // Write ledger refund record
        await tx.insert(protectionFinancialLedger).values({
          transactionType: "PREMIUM_REFUND",
          policyId: policy.id,
          amountCents: Number(policy.totalPaidCents),
          currency: "CAD",
          direction: "DEBIT",
          sourceAccount: "ESCROW_PROTECTION_RESERVE",
          destinationAccount: "CUSTOMER_PAYMENT",
          reference: `REFUND-${policy.certificateNumber}`,
          metadata: { cancellationReason: body.reason },
        });

        return cancelled!;
      });

      await audit(
        user.id,
        "PROTECTION_POLICY_CANCELLED_REFUNDED",
        "PROTECTION_POLICY",
        policy.id,
        policy,
        updated,
        { reason: body.reason },
      );

      return reply.code(200).send({
        policy: toPolicyContract(updated),
        refund: {
          refundedAmountCents: Number(policy.totalPaidCents),
          status: "REFUNDED",
          effectiveDate: new Date().toISOString(),
        },
      });
    },
  );

  // 9. Customer Submits Protection Claim
  app.post(
    "/v1/protection/policies/:id/claims",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const policyId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(createProtectionClaimSchema, request.body);

      const [policy] = await db
        .select()
        .from(protectionPolicies)
        .where(eq(protectionPolicies.id, policyId))
        .limit(1);

      if (!policy) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Policy not found",
        });
      }

      if (policy.customerId !== user.id && !isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Only the insured customer can file a claim against this policy",
        });
      }

      if (!["BOUND_ACTIVE", "CLAIM_IN_PROGRESS"].includes(policy.status)) {
        return reply.code(422).send({
          statusCode: 422,
          code: "POLICY_NOT_ACTIVE",
          message: `Cannot file claim: policy status is '${policy.status}'`,
        });
      }

      const incidentTime = new Date(body.incidentDate).getTime();
      if (
        incidentTime < new Date(policy.effectiveStartDate).getTime() ||
        incidentTime > new Date(policy.effectiveEndDate).getTime()
      ) {
        return reply.code(422).send({
          statusCode: 422,
          code: "INCIDENT_OUTSIDE_POLICY_PERIOD",
          message:
            "Incident date must occur within the active policy coverage term",
        });
      }

      const claimNumber = `CLM-2026-ON-${Math.floor(10000 + Math.random() * 90000)}`;

      const [claim] = await db.transaction(async (tx) => {
        await tx
          .update(protectionPolicies)
          .set({ status: "CLAIM_IN_PROGRESS" })
          .where(eq(protectionPolicies.id, policy.id));

        const [c] = await tx
          .insert(protectionClaims)
          .values({
            claimNumber,
            policyId: policy.id,
            serviceRequestId: policy.serviceRequestId,
            claimantUserId: user.id,
            contractorId: policy.contractorId,
            incidentDate: new Date(body.incidentDate),
            incidentDescription: body.incidentDescription,
            claimedAmountCents: body.claimedAmountCents,
            evidenceUrls: body.evidenceUrls,
            status: "SUBMITTED",
          })
          .returning();

        return [c!];
      });

      await audit(
        user.id,
        "PROTECTION_CLAIM_FILED",
        "PROTECTION_CLAIM",
        claim!.id,
        null,
        claim,
      );

      return reply.code(201).send({ claim: toClaimContract(claim!) });
    },
  );

  // 10. Query Claim by ID
  app.get(
    "/v1/protection/claims/:id",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const claimId = parse(z.object({ id: uuid }), request.params).id;

      const [claim] = await db
        .select()
        .from(protectionClaims)
        .where(eq(protectionClaims.id, claimId))
        .limit(1);

      if (!claim) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Claim not found",
        });
      }

      if (claim.claimantUserId !== user.id && !isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Tenant isolation: cannot access other users' protection claims",
        });
      }

      return reply.code(200).send({ claim: toClaimContract(claim) });
    },
  );

  // 11. Adjuster / Operations Adjudicates Claim
  app.post(
    "/v1/protection/claims/:id/adjudicate",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      requireRole(
        user,
        "OPERATIONS_AGENT",
        "DISPATCHER",
        "ADMIN",
        "SUPER_ADMIN",
      );

      const claimId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(adjudicateProtectionClaimSchema, request.body);

      const [claim] = await db
        .select()
        .from(protectionClaims)
        .where(eq(protectionClaims.id, claimId))
        .limit(1);

      if (!claim) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Claim not found",
        });
      }

      const [policy] = await db
        .select()
        .from(protectionPolicies)
        .where(eq(protectionPolicies.id, claim.policyId))
        .limit(1);

      if (!policy) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Associated policy not found",
        });
      }

      // Adjudicate via actuarial domain engine
      const adjudication = adjudicateProtectionClaim({
        claim: {
          claimedAmountCents: Number(claim.claimedAmountCents),
          incidentDate: claim.incidentDate,
          evidenceUrls: (claim.evidenceUrls as string[]) ?? [],
        },
        policy: {
          coverageLimitCents: Number(policy.coverageLimitCents),
          deductibleCents: Number(policy.deductibleCents),
          effectiveStartDate: policy.effectiveStartDate,
          effectiveEndDate: policy.effectiveEndDate,
          status: policy.status,
        },
        decision: body.decision,
        approvedAmountCents: body.approvedAmountCents,
        deductibleCents: body.deductibleCents,
        adjudicationNotes: body.adjudicationNotes,
        declineReasonCode: body.declineReasonCode,
      });

      const updatedClaim = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(protectionClaims)
          .set({
            status:
              adjudication.status === "DECLINED"
                ? "DECLINED"
                : adjudication.netPayoutCents > 0
                  ? "PAID"
                  : "APPROVED",
            adjudicatedAmountCents: adjudication.adjudicatedAmountCents,
            deductibleAppliedCents: adjudication.deductibleAppliedCents,
            netPayoutCents: adjudication.netPayoutCents,
            adjudicationNotes: adjudication.adjudicationNotes,
            adjudicatedByUserId: user.id,
            adjudicatedAt: new Date(),
            paidAt: adjudication.netPayoutCents > 0 ? new Date() : null,
            declineReasonCode: adjudication.declineReasonCode ?? null,
            updatedAt: new Date(),
          })
          .where(eq(protectionClaims.id, claim.id))
          .returning();

        // Write Claim Payout Ledger Entry
        if (adjudication.netPayoutCents > 0) {
          await tx.insert(protectionFinancialLedger).values({
            transactionType: "CLAIM_PAYOUT",
            policyId: policy.id,
            claimId: claim.id,
            amountCents: adjudication.netPayoutCents,
            currency: "CAD",
            direction: "DEBIT",
            sourceAccount: "INSURER_UNDERWRITING_ACCOUNT",
            destinationAccount: "CUSTOMER_PAYMENT",
            reference: `PAYOUT-${claim.claimNumber}`,
            metadata: {
              adjudicatedBy: user.id,
              deductibleApplied: adjudication.deductibleAppliedCents,
            },
          });
        }

        // Restore Policy Status
        await tx
          .update(protectionPolicies)
          .set({ status: "BOUND_ACTIVE" })
          .where(eq(protectionPolicies.id, policy.id));

        return updated!;
      });

      await audit(
        user.id,
        "PROTECTION_CLAIM_ADJUDICATED",
        "PROTECTION_CLAIM",
        claim.id,
        claim,
        updatedClaim,
      );

      return reply.code(200).send({
        claim: toClaimContract(updatedClaim),
        adjudicationSummary: {
          decision: updatedClaim.status,
          adjudicatedAmountCents: updatedClaim.adjudicatedAmountCents,
          deductibleAppliedCents: updatedClaim.deductibleAppliedCents,
          netPayoutCents: updatedClaim.netPayoutCents,
        },
      });
    },
  );

  // 12. Financial Reconciliation & Broker Commission Audit Ledger
  app.get(
    "/v1/protection/reconciliation",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      requireRole(user, "OPERATIONS_AGENT", "ADMIN", "SUPER_ADMIN");

      const query = parse(queryProtectionReconciliationSchema, request.query);

      const conditions = [];
      if (query.policyId) {
        conditions.push(eq(protectionFinancialLedger.policyId, query.policyId));
      }

      const rows = await db
        .select()
        .from(protectionFinancialLedger)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(protectionFinancialLedger.createdAt))
        .limit(200);

      let totalGrossPremiumsCollectedCents = 0;
      let totalBrokerCommissionsPayableCents = 0;
      let totalPlatformFeesEarnedCents = 0;
      let totalInsurerRemittancesCents = 0;
      let totalClaimsPaidCents = 0;
      let totalRefundsProcessedCents = 0;

      for (const row of rows) {
        const amt = Number(row.amountCents);
        if (row.transactionType === "PREMIUM_COLLECTION") {
          totalGrossPremiumsCollectedCents += amt;
        } else if (row.transactionType === "BROKER_COMMISSION_PAYABLE") {
          totalBrokerCommissionsPayableCents += amt;
        } else if (row.transactionType === "PLATFORM_FEE_EARNED") {
          totalPlatformFeesEarnedCents += amt;
        } else if (row.transactionType === "INSURER_PREMIUM_REMITTANCE") {
          totalInsurerRemittancesCents += amt;
        } else if (row.transactionType === "CLAIM_PAYOUT") {
          totalClaimsPaidCents += amt;
        } else if (row.transactionType === "PREMIUM_REFUND") {
          totalRefundsProcessedCents += amt;
        }
      }

      const netEscrowReserveBalanceCents =
        totalGrossPremiumsCollectedCents -
        totalBrokerCommissionsPayableCents -
        totalInsurerRemittancesCents -
        totalRefundsProcessedCents;

      return reply.code(200).send({
        entries: rows.map((r) => ({
          id: r.id,
          transactionType: r.transactionType as ProtectionLedgerEntry["transactionType"],
          policyId: r.policyId ?? null,
          claimId: r.claimId ?? null,
          amountCents: Number(r.amountCents),
          currency: r.currency,
          direction: r.direction as "CREDIT" | "DEBIT",
          sourceAccount: r.sourceAccount,
          destinationAccount: r.destinationAccount,
          reference: r.reference,
          createdAt: r.createdAt.toISOString(),
        })),
        summary: {
          totalGrossPremiumsCollectedCents,
          totalBrokerCommissionsPayableCents,
          totalPlatformFeesEarnedCents,
          totalInsurerRemittancesCents,
          totalClaimsPaidCents,
          totalRefundsProcessedCents,
          netEscrowReserveBalanceCents,
        },
      });
    },
  );
};
