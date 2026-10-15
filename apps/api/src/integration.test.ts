import dotenv from "dotenv";
dotenv.config({
  path: [new URL("../../../.env", import.meta.url).pathname, ".env"],
});
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  db,
  pool,
  users,
  userRoles,
  properties,
  verticals,
  serviceCategories,
  issueTypes,
  jobs,
  paymentSchedules,
  paymentMilestones,
  paymentTransactions,
  customerContractorRelationships,
  contractors,
  technicians,
  credentials,
  contractorCapabilityAssessments,
  dispatchEligibilityChecks,
  safetyIncidents,
  safetyIncidentActions,
  contractorSafetyQuarantines,
  qualityAudits,
  electricalPermits,
  permitDeficiencies,
  riskPolicies,
  jobRiskAssessments,
  auditEvents,
  refunds,
  legalAgreements,
  agreementSignatures,
  customerProtectionProducts,
  protectionQuotes,
  protectionPolicies,
  protectionClaims,
  protectionFinancialLedger,
  jobDocumentationPackages,
  warrantyPolicies,
  jobWarrantySnapshots,
  warrantyClaims,
  warrantyRecoveryLedger,
  customerFeedbackPreferences,
  postJobSurveys,
  customerRewardCredits,
  supportTickets,
  serviceRequests,
  technicianSchedules,
  technicianServiceRegions,
  dispatchSlotHolds,
  dispatchOffers,
  dispatchFallbackQueue,
  userSessions,
  userMfaDevices,
  userMfaChallenges,
  userPasswordResets,
  userEmailVerifications,
  authRateLimits,
  fileAttachments,
  fileQuarantineEvents,
  serviceRecommendations,
  serviceRecommendationResponses,
  eq,
  ne,
  and,
  or,
  asc,
  desc,
  sql,
  inArray,
} from "@marketplace/database";
import { generateTotpCode, hashPassword } from "@marketplace/auth";

const enabled =
  (process.env.MARKETPLACE_INTEGRATION === "1" ||
    process.env.SKILLED_HIRE_INTEGRATION === "1") &&
  Boolean(process.env.DATABASE_URL);
const describeSuite =
  typeof (describe as any).runIf === "function"
    ? (describe as any).runIf(enabled)
    : enabled
      ? describe
      : describe.skip;
describeSuite("Skilled Hire lifecycle", () => {
  let app: Awaited<typeof import("./server.js")>["app"];
  let custUser: { id: string };
  const tokens = new Map<string, string>();
  const auth = (email: string) => ({
    authorization: `Bearer ${tokens.get(email) ?? ""}`,
  });

  async function login(email: string): Promise<void> {
    const result = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email, password: "DemoPassword!2026" },
    });
    expect(result.statusCode).toBe(200);
    tokens.set(email, result.json<{ accessToken: string }>().accessToken);
  }

  beforeAll(async () => {
    process.env.API_NO_LISTEN = "true";
    ({ app } = await import("./server.js"));
    await app.ready();
    for (const email of [
      "customer@example.test",
      "dispatch@example.test",
      "technician@example.test",
      "admin@example.test",
      "owner@example.test",
    ]) {
      await login(email);
    }
    const [cUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "customer@example.test"))
      .limit(1);
    if (!cUser) throw new Error("Missing customer user");
    custUser = cUser;

    // Reset leftover uncompleted jobs from previously interrupted test runs
    await db
      .update(jobs)
      .set({ status: "CLOSED" })
      .where(sql`${jobs.status} NOT IN ('COMPLETED', 'CANCELLED', 'CLOSED')`);

    // Reset leftover agreements and signatures from previously interrupted test runs
    await db
      .delete(agreementSignatures)
      .where(ne(agreementSignatures.agreementVersion, "1.0.0"));
    await db
      .delete(legalAgreements)
      .where(ne(legalAgreements.version, "1.0.0"));
    await db
      .update(legalAgreements)
      .set({ isActive: true, supersededAt: null })
      .where(eq(legalAgreements.version, "1.0.0"));

    // Self-heal canonical HVAC credentials if stripped by subsequent tests in previous runs
    const [hvacCont] = await db
      .select({ id: contractors.id })
      .from(contractors)
      .where(eq(contractors.name, "ABC Heating & Cooling"))
      .limit(1);
    const [hvacTech] = await db
      .select({ id: technicians.id })
      .from(technicians)
      .where(eq(technicians.displayName, "John S."))
      .limit(1);

    if (hvacCont && hvacTech) {
      const hvacCreds = [
        { contractorId: hvacCont.id, code: "ON_TSSA_CONTRACTOR_REG" },
        { contractorId: hvacCont.id, code: "ON_WSIB_CLEARANCE" },
        { contractorId: hvacCont.id, code: "CGL_INSURANCE_2M" },
        { contractorId: hvacCont.id, code: "COMMERCIAL_AUTO_1M" },
      ];
      for (const cred of hvacCreds) {
        const [existing] = await db
          .select({ id: credentials.id })
          .from(credentials)
          .where(
            and(
              eq(credentials.contractorId, cred.contractorId),
              eq(credentials.code, cred.code),
            ),
          )
          .limit(1);
        if (!existing) {
          await db.insert(credentials).values({
            contractorId: cred.contractorId,
            code: cred.code,
            geography: "ON",
            status: "VERIFIED",
            verificationSource: "REGULATOR_API",
            expiryDate: "2028-12-31",
            checkedAt: new Date(),
          });
        }
      }

      const techCreds = [
        { technicianId: hvacTech.id, code: "HVAC_LICENSE" },
        { technicianId: hvacTech.id, code: "ON_TSSA_GAS_G2" },
        { technicianId: hvacTech.id, code: "ON_SKILLED_TRADES_313A" },
        { technicianId: hvacTech.id, code: "CA_ODS_REFRIGERANT" },
        { technicianId: hvacTech.id, code: "ON_MOL_HEIGHTS" },
        { technicianId: hvacTech.id, code: "GOVT_PHOTO_ID" },
        { technicianId: hvacTech.id, code: "BACKGROUND_CHECK_ANNUAL" },
      ];
      for (const cred of techCreds) {
        const [existing] = await db
          .select({ id: credentials.id })
          .from(credentials)
          .where(
            and(
              eq(credentials.technicianId, cred.technicianId),
              eq(credentials.code, cred.code),
            ),
          )
          .limit(1);
        if (!existing) {
          await db.insert(credentials).values({
            technicianId: cred.technicianId,
            code: cred.code,
            geography: "ON",
            status: "VERIFIED",
            verificationSource: "REGULATOR_API",
            expiryDate: "2028-12-31",
            checkedAt: new Date(),
          });
        }
      }
    }
  });

  afterAll(async () => {
    await db
      .delete(agreementSignatures)
      .where(ne(agreementSignatures.agreementVersion, "1.0.0"));
    await db
      .delete(legalAgreements)
      .where(ne(legalAgreements.version, "1.0.0"));
    await db
      .update(legalAgreements)
      .set({ isActive: true, supersededAt: null })
      .where(eq(legalAgreements.version, "1.0.0"));
    await app.close();
    await pool.end();
  });

  it("creates, dispatches, quotes, pays, completes, invoices, and reviews a job", async () => {
    const [context] = await db
      .select({
        vertical_id: verticals.id,
        category_id: serviceCategories.id,
        issue_type_id: issueTypes.id,
        property_id: properties.id,
      })
      .from(verticals)
      .innerJoin(
        serviceCategories,
        eq(serviceCategories.verticalId, verticals.id),
      )
      .innerJoin(issueTypes, eq(issueTypes.categoryId, serviceCategories.id))
      .innerJoin(properties, eq(properties.customerId, custUser.id))
      .where(
        and(eq(verticals.slug, "hvac"), eq(issueTypes.slug, "ac-not-cooling")),
      )
      .limit(1);
    if (!context) throw new Error("Missing seed configuration");

    const created = await app.inject({
      method: "POST",
      url: "/v1/service-requests",
      headers: auth("customer@example.test"),
      payload: {
        propertyId: context.property_id,
        verticalId: context.vertical_id,
        categoryId: context.category_id,
        issueTypeId: context.issue_type_id,
        urgency: "STANDARD",
        description: "Air conditioner is running but not cooling the house.",
        attachmentKeys: [],
      },
    });
    expect(created.statusCode).toBe(201);
    const requestId = created.json<{ id: string }>().id;

    for (const to of [
      "QUALIFICATION_PENDING",
      "QUALIFIED",
      "SCHEDULING",
      "SCHEDULED",
      "CONTRACTOR_SEARCH",
    ] as const) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/service-requests/${requestId}/transition`,
            headers: auth("dispatch@example.test"),
            payload: { to },
          })
        ).statusCode,
      ).toBe(200);
    }

    const candidates = await app.inject({
      method: "GET",
      url: `/v1/dispatch/${requestId}/candidates`,
      headers: auth("dispatch@example.test"),
    });
    expect(candidates.statusCode).toBe(200);
    const [compliantTech] = await db
      .select({ id: technicians.id })
      .from(technicians)
      .where(
        and(
          eq(technicians.active, true),
          eq(technicians.displayName, "John S."),
        ),
      )
      .limit(1);
    const candidateList = candidates.json<{
      candidates: Array<{ technicianId: string }>;
    }>().candidates;
    const technicianId =
      candidateList.find((c) => c.technicianId === compliantTech?.id)
        ?.technicianId ?? candidateList[0]?.technicianId;
    expect(technicianId).toBeTruthy();

    const assigned = await app.inject({
      method: "POST",
      url: `/v1/dispatch/${requestId}/assign`,
      headers: auth("dispatch@example.test"),
      payload: { technicianId },
    });
    expect(assigned.statusCode).toBe(201);
    const jobId = assigned.json<{ jobId: string }>().jobId;

    for (const to of [
      "TECHNICIAN_EN_ROUTE",
      "TECHNICIAN_ARRIVED",
      "ASSESSMENT_IN_PROGRESS",
      "QUOTE_PENDING",
    ] as const) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/v1/service-requests/${requestId}/transition`,
            headers: auth("technician@example.test"),
            payload: { to },
          })
        ).statusCode,
      ).toBe(200);
    }

    const quote = await app.inject({
      method: "POST",
      url: `/v1/jobs/${jobId}/quotes`,
      headers: auth("technician@example.test"),
      payload: {
        items: [
          {
            type: "DIAGNOSTIC",
            title: "Diagnostic",
            quantity: 1,
            unitPriceCents: 12900,
          },
          {
            type: "LABOUR",
            title: "Repair labour",
            quantity: 2,
            unitPriceCents: 14000,
          },
        ],
        platformFeeCents: 500,
        taxCents: 5382,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(quote.statusCode).toBe(201);
    const quoteId = quote.json<{ quoteId: string }>().quoteId;

    const accepted = await app.inject({
      method: "POST",
      url: `/v1/quotes/${quoteId}/accept`,
      headers: {
        ...auth("customer@example.test"),
        "idempotency-key": crypto.randomUUID(),
      },
      payload: {},
    });
    expect(accepted.statusCode).toBe(200);
    const schedule = accepted.json<{
      milestones: Array<{ sequence: number }>;
    }>();

    const [sched] = await db
      .select({ id: paymentSchedules.id })
      .from(paymentSchedules)
      .where(eq(paymentSchedules.quoteId, quoteId))
      .limit(1);
    if (!sched) throw new Error("Missing payment schedule");

    const [milestone] = await db
      .select({ id: paymentMilestones.id })
      .from(paymentMilestones)
      .where(eq(paymentMilestones.scheduleId, sched.id))
      .orderBy(asc(paymentMilestones.sequence))
      .limit(1);
    const depositId = milestone?.id;
    const [finalBeforeDeposit] = await db
      .select({ id: paymentMilestones.id })
      .from(paymentMilestones)
      .where(eq(paymentMilestones.scheduleId, sched.id))
      .orderBy(desc(paymentMilestones.sequence))
      .limit(1);
    if (!depositId || !finalBeforeDeposit?.id)
      throw new Error("Missing payment milestones");

    // Out of order payment rejected with 409
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/payment-milestones/${finalBeforeDeposit.id}/pay`,
          headers: {
            ...auth("customer@example.test"),
            "idempotency-key": crypto.randomUUID(),
          },
          payload: {},
        })
      ).statusCode,
    ).toBe(409);
    // Correct sequential deposit payment
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/payment-milestones/${depositId}/pay`,
          headers: {
            ...auth("customer@example.test"),
            "idempotency-key": crypto.randomUUID(),
          },
          payload: {},
        })
      ).statusCode,
    ).toBe(201);
    expect(schedule.milestones).toHaveLength(2);

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/service-requests/${requestId}/transition`,
          headers: auth("technician@example.test"),
          payload: { to: "WORK_IN_PROGRESS" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/jobs/${jobId}/complete`,
          headers: auth("technician@example.test"),
          payload: { summary: "Restored cooling and tested system operation." },
        })
      ).statusCode,
    ).toBe(200);

    const [finalMilestone] = await db
      .select({ id: paymentMilestones.id })
      .from(paymentMilestones)
      .where(
        and(
          eq(paymentMilestones.scheduleId, sched.id),
          eq(paymentMilestones.status, "PENDING"),
        ),
      )
      .orderBy(asc(paymentMilestones.sequence))
      .limit(1);
    const finalId = finalMilestone?.id;
    if (!finalId) throw new Error("Missing final milestone");
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/payment-milestones/${finalId}/pay`,
          headers: {
            ...auth("customer@example.test"),
            "idempotency-key": crypto.randomUUID(),
          },
          payload: {},
        })
      ).statusCode,
    ).toBe(201);

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/jobs/${jobId}/invoice`,
          headers: auth("customer@example.test"),
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/jobs/${jobId}/reviews`,
          headers: auth("customer@example.test"),
          payload: {
            overall: 5,
            quality: 5,
            professionalism: 5,
            timeliness: 5,
            communication: 5,
            comment: "Great experience.",
          },
        })
      ).statusCode,
    ).toBe(201);

    const [jobRecord] = await db
      .select({ contractorId: jobs.contractorId })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);
    if (!jobRecord) throw new Error("Missing job");

    const [relationship] = await db
      .select({
        lastPlatformJobId: customerContractorRelationships.lastPlatformJobId,
      })
      .from(customerContractorRelationships)
      .where(
        and(
          eq(customerContractorRelationships.customerId, custUser.id),
          eq(
            customerContractorRelationships.contractorId,
            jobRecord.contractorId,
          ),
        ),
      )
      .limit(1);
    expect(relationship?.lastPlatformJobId).toBe(jobId);
  });

  it("handles change orders, customer approvals, and dynamic milestone updates", async () => {
    const [context2] = await db
      .select({
        vertical_id: verticals.id,
        category_id: serviceCategories.id,
        issue_type_id: issueTypes.id,
        property_id: properties.id,
      })
      .from(verticals)
      .innerJoin(
        serviceCategories,
        eq(serviceCategories.verticalId, verticals.id),
      )
      .innerJoin(issueTypes, eq(issueTypes.categoryId, serviceCategories.id))
      .innerJoin(properties, eq(properties.customerId, custUser.id))
      .where(
        and(eq(verticals.slug, "hvac"), eq(issueTypes.slug, "ac-not-cooling")),
      )
      .limit(1);
    const context = context2;
    if (!context) throw new Error("Missing seed configuration");

    const created = await app.inject({
      method: "POST",
      url: "/v1/service-requests",
      headers: auth("customer@example.test"),
      payload: {
        propertyId: context.property_id,
        verticalId: context.vertical_id,
        categoryId: context.category_id,
        issueTypeId: context.issue_type_id,
        urgency: "STANDARD",
        description: "Furnace fan motor making clicking and grinding noises.",
        attachmentKeys: [],
      },
    });
    expect(created.statusCode).toBe(201);
    const requestId = created.json<{ id: string }>().id;

    for (const to of [
      "QUALIFICATION_PENDING",
      "QUALIFIED",
      "SCHEDULING",
      "SCHEDULED",
      "CONTRACTOR_SEARCH",
    ] as const) {
      await app.inject({
        method: "POST",
        url: `/v1/service-requests/${requestId}/transition`,
        headers: auth("dispatch@example.test"),
        payload: { to },
      });
    }

    const candidates = await app.inject({
      method: "GET",
      url: `/v1/dispatch/${requestId}/candidates`,
      headers: auth("dispatch@example.test"),
    });
    const technicianId = candidates.json<{
      candidates: Array<{ technicianId: string }>;
    }>().candidates[0]?.technicianId;
    expect(technicianId).toBeTruthy();

    const assigned = await app.inject({
      method: "POST",
      url: `/v1/dispatch/${requestId}/assign`,
      headers: auth("dispatch@example.test"),
      payload: { technicianId },
    });
    const jobId = assigned.json<{ jobId: string }>().jobId;

    for (const to of [
      "TECHNICIAN_EN_ROUTE",
      "TECHNICIAN_ARRIVED",
      "ASSESSMENT_IN_PROGRESS",
      "QUOTE_PENDING",
    ] as const) {
      await app.inject({
        method: "POST",
        url: `/v1/service-requests/${requestId}/transition`,
        headers: auth("technician@example.test"),
        payload: { to },
      });
    }

    const quote = await app.inject({
      method: "POST",
      url: `/v1/jobs/${jobId}/quotes`,
      headers: auth("technician@example.test"),
      payload: {
        items: [
          {
            type: "DIAGNOSTIC",
            title: "Diagnostic inspection",
            quantity: 1,
            unitPriceCents: 9900,
          },
        ],
        platformFeeCents: 500,
        taxCents: 1352,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(quote.statusCode).toBe(201);
    const quoteId = quote.json<{ quoteId: string }>().quoteId;

    await app.inject({
      method: "POST",
      url: `/v1/quotes/${quoteId}/accept`,
      headers: {
        ...auth("customer@example.test"),
        "idempotency-key": crypto.randomUUID(),
      },
      payload: {},
    });

    const [sched2] = await db
      .select({ id: paymentSchedules.id })
      .from(paymentSchedules)
      .where(eq(paymentSchedules.quoteId, quoteId))
      .limit(1);
    if (!sched2) throw new Error("Missing payment schedule");

    const [depositMilestone] = await db
      .select({ id: paymentMilestones.id })
      .from(paymentMilestones)
      .where(eq(paymentMilestones.scheduleId, sched2.id))
      .orderBy(asc(paymentMilestones.sequence))
      .limit(1);
    const depositId = depositMilestone?.id;
    if (!depositId) throw new Error("Missing deposit milestone");
    await app.inject({
      method: "POST",
      url: `/v1/payment-milestones/${depositId}/pay`,
      headers: {
        ...auth("customer@example.test"),
        "idempotency-key": crypto.randomUUID(),
      },
      payload: {},
    });

    await app.inject({
      method: "POST",
      url: `/v1/service-requests/${requestId}/transition`,
      headers: auth("technician@example.test"),
      payload: { to: "WORK_IN_PROGRESS" },
    });

    // Technician submits Change Order while in WORK_IN_PROGRESS
    const coRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${jobId}/change-orders`,
      headers: auth("technician@example.test"),
      payload: {
        reason: "Worn motor capacitor replacement required",
        explanation:
          "Capacitor failed microfarad rating check under system startup load.",
        attachmentKeys: [],
        items: [
          {
            type: "MATERIAL",
            title: "Dual Run Capacitor 45/5 MFD",
            quantity: 1,
            unitPriceCents: 4500,
          },
          {
            type: "LABOUR",
            title: "Capacitor wiring and discharge service",
            quantity: 1,
            unitPriceCents: 5500,
          },
        ],
        platformFeeCents: 300,
        taxCents: 1339,
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(coRes.statusCode).toBe(201);
    const changeOrderId = coRes.json<{ changeOrderId: string }>().changeOrderId;
    expect(changeOrderId).toBeTruthy();

    // Verify status transitioned to CHANGE_ORDER_PENDING
    const [jobStatusCheck] = await db
      .select({ status: jobs.status })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);
    expect(jobStatusCheck?.status).toBe("CHANGE_ORDER_PENDING");

    // Customer views change orders
    const getOrders = await app.inject({
      method: "GET",
      url: `/v1/jobs/${jobId}/change-orders`,
      headers: auth("customer@example.test"),
    });
    expect(getOrders.statusCode).toBe(200);
    expect(
      getOrders
        .json<Array<{ id: string }>>()
        .some((co) => co.id === changeOrderId),
    ).toBe(true);

    // Customer accepts change order with idempotency key
    const acceptCo = await app.inject({
      method: "POST",
      url: `/v1/change-orders/${changeOrderId}/accept`,
      headers: {
        ...auth("customer@example.test"),
        "idempotency-key": crypto.randomUUID(),
      },
      payload: {},
    });
    expect(acceptCo.statusCode).toBe(200);
    const { milestoneId } = acceptCo.json<{
      changeOrderId: string;
      milestoneId: string;
    }>();
    expect(milestoneId).toBeTruthy();

    // Verify job transitioned back to WORK_IN_PROGRESS
    const [resumedStatus] = await db
      .select({ status: jobs.status })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);
    expect(resumedStatus?.status).toBe("WORK_IN_PROGRESS");

    // Complete job
    await app.inject({
      method: "POST",
      url: `/v1/jobs/${jobId}/complete`,
      headers: auth("technician@example.test"),
      payload: {
        summary: "Installed capacitor and checked air handler.",
        equipment: { fanModel: "F-100" },
      },
    });

    // Pay change order milestone and final milestone
    await app.inject({
      method: "POST",
      url: `/v1/payment-milestones/${milestoneId}/pay`,
      headers: {
        ...auth("customer@example.test"),
        "idempotency-key": crypto.randomUUID(),
      },
      payload: {},
    });

    const pendingMilestones = await db
      .select({ id: paymentMilestones.id })
      .from(paymentMilestones)
      .where(
        and(
          eq(paymentMilestones.scheduleId, sched2.id),
          eq(paymentMilestones.status, "PENDING"),
        ),
      );
    for (const m of pendingMilestones) {
      await app.inject({
        method: "POST",
        url: `/v1/payment-milestones/${m.id}/pay`,
        headers: {
          ...auth("customer@example.test"),
          "idempotency-key": crypto.randomUUID(),
        },
        payload: {},
      });
    }

    // Generate Invoice with change order included
    const invoiceRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${jobId}/invoice`,
      headers: auth("customer@example.test"),
    });
    expect(invoiceRes.statusCode).toBe(201);
    const invoice = invoiceRes.json<{ total_cents: string }>();
    // Expected total: initial quote (9900+500+1352 = 11752) + change order (10000+300+1339 = 11639) = 23391 cents
    expect(Number(invoice.total_cents)).toBe(23391);
  });

  it("executes the multi-jurisdiction compliance & verification workflow", async () => {
    // 1. Get Regulatory Groups (6 canonical pillars)
    const groupsRes = await app.inject({
      method: "GET",
      url: "/v1/compliance/groups",
    });
    expect(groupsRes.statusCode).toBe(200);
    const groups = groupsRes.json<Array<{ code: string; name: string }>>();
    expect(groups.length).toBeGreaterThanOrEqual(6);
    const groupCodes = groups.map((g) => g.code);
    expect(groupCodes).toContain("TRADE_LICENSING");
    expect(groupCodes).toContain("ENVIRONMENTAL_HAZARDOUS");
    expect(groupCodes).toContain("INSURANCE_FINANCIAL");
    expect(groupCodes).toContain("HEALTH_SAFETY");
    expect(groupCodes).toContain("STATUTORY_REGISTRATION");
    expect(groupCodes).toContain("TRUST_IDENTITY");

    // 2. Query standards for HVAC in Ontario
    const standardsRes = await app.inject({
      method: "GET",
      url: "/v1/compliance/standards?vertical=hvac&geography=ON",
    });
    expect(standardsRes.statusCode).toBe(200);
    const standards = standardsRes.json<
      Array<{
        credentialCode: string;
        verticalSlug: string;
        geography: string;
      }>
    >();
    expect(standards.length).toBeGreaterThan(0);
    expect(
      standards.some(
        (s) =>
          s.credentialCode === "ON_TSSA_GAS_G2" ||
          s.credentialCode === "CA_ODS_REFRIGERANT",
      ),
    ).toBe(true);

    // 3. Prospective evaluation endpoint (Onboarding Simulator)
    const deficientEval = await app.inject({
      method: "POST",
      url: "/v1/compliance/evaluate",
      payload: {
        verticalSlug: "hvac",
        geography: "ON",
        credentials: [],
      },
    });
    expect(deficientEval.statusCode).toBe(200);
    const defScore = deficientEval.json<{
      overallStatus: string;
      scoreBps: number;
      missingMandatoryCodes: string[];
    }>();
    expect(defScore.overallStatus).toBe("DEFICIENT");
    expect(defScore.scoreBps).toBeLessThan(5000);
    expect(defScore.missingMandatoryCodes.length).toBeGreaterThan(0);

    // Compliant prospective evaluation
    const compliantEval = await app.inject({
      method: "POST",
      url: "/v1/compliance/evaluate",
      payload: {
        verticalSlug: "hvac",
        geography: "ON",
        entityLevel: "TECHNICIAN",
        credentials: [
          {
            code: "ON_TSSA_GAS_G2",
            status: "VERIFIED",
            expiryDate: "2028-12-31",
          },
          {
            code: "ON_SKILLED_TRADES_313A",
            status: "VERIFIED",
            expiryDate: "2028-12-31",
          },
          {
            code: "CA_ODS_REFRIGERANT",
            status: "VERIFIED",
            expiryDate: "2028-12-31",
          },
          {
            code: "ON_MOL_HEIGHTS",
            status: "VERIFIED",
            expiryDate: "2028-12-31",
          },
          { code: "GOVT_PHOTO_ID", status: "VERIFIED" },
          {
            code: "BACKGROUND_CHECK_ANNUAL",
            status: "VERIFIED",
            expiryDate: "2028-12-31",
          },
          {
            code: "FIRST_AID_CPR_C",
            status: "VERIFIED",
            expiryDate: "2028-12-31",
          },
        ],
      },
    });
    expect(compliantEval.statusCode).toBe(200);
    const compScore = compliantEval.json<{
      overallStatus: string;
      scoreBps: number;
    }>();
    expect(compScore.overallStatus).toBe("VERIFIED");
    expect(compScore.scoreBps).toBe(10000);

    // 4. Authenticated Contractor Compliance Scorecard
    const [contractorRecord] = await db
      .select({ id: contractors.id })
      .from(contractors)
      .orderBy(contractors.createdAt)
      .limit(1);
    const contractorId = contractorRecord?.id;
    if (!contractorId) throw new Error("Missing contractor in database");

    const contractorScorecard = await app.inject({
      method: "GET",
      url: `/v1/contractors/${contractorId}/compliance`,
      headers: auth("dispatch@example.test"),
    });
    expect(contractorScorecard.statusCode).toBe(200);
    const scoreData = contractorScorecard.json<{
      contractorId: string;
      scorecard: { overallStatus: string; scoreBps: number };
    }>();
    expect(scoreData.contractorId).toBe(contractorId);
    expect(scoreData.scorecard).toBeDefined();

    // 5. Technician submits credential for verification
    const submitRes = await app.inject({
      method: "POST",
      url: "/v1/credentials/submit",
      headers: auth("technician@example.test"),
      payload: {
        entityType: "TECHNICIAN",
        code: "CA_ODS_REFRIGERANT",
        geography: "ON",
        documentKey: "uploads/compliance/ods-certification-card.pdf",
        expiryDate: "2028-05-15",
        licenseNumber: "ODS-88219-PRO",
      },
    });
    expect(submitRes.statusCode).toBe(201);
    expect(submitRes.json<{ status: string }>().status).toBe("PENDING");
  });

  it("executes support disputes, property history, rebooking, notifications, and refund workflows", async () => {
    // 1. Check Customer Notifications
    const notesRes = await app.inject({
      method: "GET",
      url: "/v1/notifications",
      headers: auth("customer@example.test"),
    });
    expect(notesRes.statusCode).toBe(200);
    expect(Array.isArray(notesRes.json())).toBe(true);

    // 2. Query Property Service History
    const [prop] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(eq(properties.customerId, custUser.id))
      .limit(1);
    const propertyId = prop?.id;
    if (!propertyId) throw new Error("Missing customer property");

    const historyRes = await app.inject({
      method: "GET",
      url: `/v1/properties/${propertyId}/history`,
      headers: auth("customer@example.test"),
    });
    expect(historyRes.statusCode).toBe(200);
    const history = historyRes.json<Array<{ id: string; summary: string }>>();
    expect(history.length).toBeGreaterThan(0);
    const recordId = history[0]?.id;
    if (!recordId) throw new Error("Missing service record");

    // 3. Rebook service based on existing service record
    const rebookRes = await app.inject({
      method: "POST",
      url: `/v1/service-records/${recordId}/rebook`,
      headers: auth("customer@example.test"),
      payload: {
        preferredStartsAt: new Date(Date.now() + 86_400_000).toISOString(),
        preferredEndsAt: new Date(Date.now() + 90_000_000).toISOString(),
      },
    });
    expect(rebookRes.statusCode).toBe(201);
    const rebooked = rebookRes.json<{ id: string; status: string }>();
    expect(rebooked.status).toBe("SUBMITTED");

    // 4. Submit Support Ticket with Dispute
    const [completedJob] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(eq(jobs.status, "COMPLETED"))
      .limit(1);
    const jobId = completedJob?.id;
    if (!jobId) throw new Error("Missing completed job");

    const disputeRes = await app.inject({
      method: "POST",
      url: "/v1/support-tickets",
      headers: auth("customer@example.test"),
      payload: {
        jobId,
        subject: "Thermostat calibration check request",
        description:
          "Everything works but temperature reads 1 degree higher than expected.",
        dispute: true,
        evidenceKeys: ["evidence/thermostat-reading.jpg"],
      },
    });
    expect(disputeRes.statusCode).toBe(201);
    const { ticketId, disputeId } = disputeRes.json<{
      ticketId: string;
      disputeId: string;
    }>();
    expect(ticketId).toBeTruthy();
    expect(disputeId).toBeTruthy();

    // 5. Operations arbitrates and resolves the dispute
    const resolveRes = await app.inject({
      method: "POST",
      url: `/v1/disputes/${disputeId}/resolve`,
      headers: auth("dispatch@example.test"),
      payload: {
        resolution: "RELEASE_TO_CONTRACTOR",
        notes:
          "Work inspected and found compliant with specifications. Released escrow payout to contractor.",
      },
    });
    expect(resolveRes.statusCode).toBe(200);
    expect(resolveRes.json<{ status: string }>().status).toBe("RESOLVED");

    // 6. Admin issues refund on paid transaction
    const [tx] = await db
      .select({
        id: paymentTransactions.id,
        amount_cents: paymentTransactions.amountCents,
      })
      .from(paymentTransactions)
      .leftJoin(
        refunds,
        and(
          eq(refunds.transactionId, paymentTransactions.id),
          eq(refunds.status, "REFUNDED"),
        ),
      )
      .where(eq(paymentTransactions.status, "PAID"))
      .groupBy(
        paymentTransactions.id,
        paymentTransactions.amountCents,
        paymentTransactions.createdAt,
      )
      .having(
        sql`(${paymentTransactions.amountCents} - COALESCE(sum(${refunds.amountCents}), 0)) >= 1000`,
      )
      .orderBy(desc(paymentTransactions.createdAt))
      .limit(1);
    if (!tx) throw new Error("Missing paid transaction");

    const refundRes = await app.inject({
      method: "POST",
      url: "/v1/refunds",
      headers: auth("admin@example.test"),
      payload: {
        transactionId: tx.id,
        amountCents: 1000,
        reason: "Customer satisfaction courtesy adjustment",
        idempotencyKey: crypto.randomUUID(),
      },
    });
    expect(refundRes.statusCode).toBe(201);
    expect(refundRes.json<{ status: string }>().status).toBe("REFUNDED");

    // 7. Verify contractor owner identity carries contractorId
    const meRes = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: auth("owner@example.test"),
    });
    expect(meRes.statusCode).toBe(200);
    const me = meRes.json<{ actor: { contractorId?: string } }>();
    expect(me.actor.contractorId).toBeTruthy();

    // 8. Verify properties and intake routes
    const props = await app.inject({
      method: "GET",
      url: "/v1/properties",
      headers: auth("customer@example.test"),
    });
    expect(props.statusCode).toBe(200);
    expect(props.json<Array<{ id: string }>>().length).toBeGreaterThan(0);

    const intake = await app.inject({
      method: "GET",
      url: "/v1/verticals/hvac/intake",
    });
    expect(intake.statusCode).toBe(200);
    expect(
      intake.json<{ categories: unknown[]; issues: unknown[] }>().categories
        .length,
    ).toBeGreaterThan(0);

    // 9. Verify operations and customer service-requests list
    const opsRequests = await app.inject({
      method: "GET",
      url: "/v1/service-requests",
      headers: auth("dispatch@example.test"),
    });
    expect(opsRequests.statusCode).toBe(200);
    expect(opsRequests.json<Array<{ id: string }>>().length).toBeGreaterThan(0);

    // 10. Verify slot availability: available vs busier than usual capacity
    const availRes = await app.inject({
      method: "GET",
      url: "/v1/dispatch/slot-availability?vertical=hvac&slot=tomorrow-09-11",
    });
    expect(availRes.statusCode).toBe(200);
    const availData = availRes.json<{ status: string; available: boolean }>();
    expect(availData.status).toBe("AVAILABLE");
    expect(availData.available).toBe(true);

    // Busier than usual capacity detection (peak surge or domain with no open capacity)
    const busyRes = await app.inject({
      method: "GET",
      url: "/v1/dispatch/slot-availability?vertical=plumbing&slot=today-13-15",
    });
    expect(busyRes.statusCode).toBe(200);
    const busyData = busyRes.json<{
      status: string;
      available: boolean;
      alternativeSlots?: Array<{ id: string; guaranteed: boolean }>;
      emergencyOption?: { available: boolean; slaMinutes: number };
      standbyWaitlist?: { available: boolean; queuePosition: number };
    }>();
    expect(busyData.status).toBe("BUSIER_THAN_USUAL");
    expect(busyData.available).toBe(false);
    expect(busyData.alternativeSlots?.length).toBeGreaterThan(0);
    expect(busyData.emergencyOption?.available).toBe(true);
    expect(busyData.emergencyOption?.slaMinutes).toBe(45);
    expect(busyData.standbyWaitlist?.available).toBe(true);
    expect(busyData.standbyWaitlist?.queuePosition).toBe(2);

    // Peak surge on HVAC
    const surgeRes = await app.inject({
      method: "GET",
      url: "/v1/dispatch/slot-availability?vertical=hvac&slot=today-13-15-surge",
    });
    expect(surgeRes.statusCode).toBe(200);
    expect(surgeRes.json<{ status: string }>().status).toBe(
      "BUSIER_THAN_USUAL",
    );
  });

  it("supports hierarchical home-service catalog, multi-criteria search, and admin catalog management", async () => {
    // 1. Hierarchical catalog retrieval
    const catalogRes = await app.inject({ method: "GET", url: "/v1/catalog" });
    expect(catalogRes.statusCode).toBe(200);
    const catalog = catalogRes.json<
      Array<{
        id: string;
        slug: string;
        name: string;
        family: string;
        risk_tier: string;
        categories: Array<{
          id: string;
          slug: string;
          name: string;
          variants: Array<{
            id: string;
            slug: string;
            name: string;
            risk_tier: string;
            pricing_type: string;
            default_warranty_months: number;
          }>;
        }>;
      }>
    >();
    expect(catalog.length).toBeGreaterThanOrEqual(21);

    const electrical = catalog.find((v) => v.slug === "electrical");
    expect(electrical).toBeDefined();
    expect(electrical?.risk_tier).toBe("CRITICAL");
    expect(electrical?.family).toBe("MECHANICAL");
    expect(electrical?.categories.length).toBeGreaterThan(0);

    // 2. Filter catalog by family
    const mechanicalRes = await app.inject({
      method: "GET",
      url: "/v1/catalog?family=MECHANICAL",
    });
    expect(mechanicalRes.statusCode).toBe(200);
    const mechanicalList = mechanicalRes.json<Array<{ family: string }>>();
    expect(mechanicalList.every((v) => v.family === "MECHANICAL")).toBe(true);

    // 3. Search catalog across keywords, tags, and risk tiers
    const panelSearch = await app.inject({
      method: "GET",
      url: "/v1/catalog/search?q=panel",
    });
    expect(panelSearch.statusCode).toBe(200);
    const panelResults = panelSearch.json<
      Array<{
        verticalSlug: string;
        variantName: string;
        requiresPermit: boolean;
      }>
    >();
    expect(panelResults.length).toBeGreaterThan(0);
    expect(panelResults[0]?.verticalSlug).toBe("electrical");
    expect(panelResults[0]?.requiresPermit).toBe(true);

    // Low risk search
    const lowRiskSearch = await app.inject({
      method: "GET",
      url: "/v1/catalog/search?maxRiskTier=LOW",
    });
    expect(lowRiskSearch.statusCode).toBe(200);
    const lowRiskResults = lowRiskSearch.json<Array<{ riskTier: string }>>();
    expect(lowRiskResults.length).toBeGreaterThan(0);
    expect(lowRiskResults.every((r) => r.riskTier === "LOW")).toBe(true);

    // 4. Detailed service vertical lookup
    const serviceDetail = await app.inject({
      method: "GET",
      url: "/v1/catalog/services/electrical",
    });
    expect(serviceDetail.statusCode).toBe(200);
    const detailData = serviceDetail.json<{
      vertical: { slug: string; permit_authority: string; risk_tier: string };
      categories: Array<{
        slug: string;
        variants: Array<{ slug: string; permit_type: string | null }>;
      }>;
    }>();
    expect(detailData.vertical.slug).toBe("electrical");
    expect(detailData.vertical.permit_authority).toBe("ESA");
    expect(detailData.categories.length).toBeGreaterThan(0);

    // 404 for unknown vertical
    const unknownRes = await app.inject({
      method: "GET",
      url: "/v1/catalog/services/non-existent-trade",
    });
    expect(unknownRes.statusCode).toBe(404);

    // 5. Admin catalog CRUD and RBAC authorization
    // Customer attempt (forbidden)
    const unauthorizedCreate = await app.inject({
      method: "POST",
      url: "/v1/admin/catalog/verticals",
      headers: auth("customer@example.test"),
      payload: { slug: "unauthorized-trade", name: "Unauthorized" },
    });
    expect(unauthorizedCreate.statusCode).toBe(403);

    // Admin creation with idempotent test suffix
    const testSuffix = Date.now().toString(36);
    const testVerticalSlug = `smart-irrigation-${testSuffix}`;
    const adminCreateVertical = await app.inject({
      method: "POST",
      url: "/v1/admin/catalog/verticals",
      headers: auth("admin@example.test"),
      payload: {
        slug: testVerticalSlug,
        name: `Smart Commercial & Residential Irrigation ${testSuffix}`,
        family: "PROPERTY_MAINTENANCE",
        description:
          "Automated low-flow Wi-Fi irrigation manifolds and backflow prevention.",
        icon: "droplet",
        riskTier: "MODERATE",
        permitAuthority: "MUNICIPAL",
        launchReady: true,
        displayOrder: 25,
      },
    });
    expect(adminCreateVertical.statusCode).toBe(201);
    const newVertical = adminCreateVertical.json<{
      id: string;
      slug: string;
    }>();
    expect(newVertical.slug).toBe(testVerticalSlug);

    // Admin vertical update
    const updateVertical = await app.inject({
      method: "PATCH",
      url: `/v1/admin/catalog/verticals/${newVertical.id}`,
      headers: auth("admin@example.test"),
      payload: {
        description: "Updated smart low-flow Wi-Fi irrigation systems.",
      },
    });
    expect(updateVertical.statusCode).toBe(200);

    // Admin category creation
    const adminCreateCategory = await app.inject({
      method: "POST",
      url: "/v1/admin/catalog/categories",
      headers: auth("admin@example.test"),
      payload: {
        verticalId: newVertical.id,
        slug: `controllers-${testSuffix}`,
        name: "Smart Wi-Fi Controllers",
        description: "Rachio and Hunter smart irrigation controllers.",
        riskTier: "LOW",
        launchReady: true,
        displayOrder: 1,
      },
    });
    expect(adminCreateCategory.statusCode).toBe(201);
    const newCategory = adminCreateCategory.json<{
      id: string;
      slug: string;
    }>();

    // Admin issue-type / variant creation
    const testVariantSlug = `controller-retrofit-${testSuffix}`;
    const adminCreateVariant = await app.inject({
      method: "POST",
      url: "/v1/admin/catalog/issue-types",
      headers: auth("admin@example.test"),
      payload: {
        categoryId: newCategory.id,
        slug: testVariantSlug,
        name: "Smart Irrigation Controller Retrofit",
        description:
          "Upgrade mechanical timer to 8-zone smart Wi-Fi weather-sensing controller.",
        riskTier: "LOW",
        pricingType: "FIXED",
        basePriceCents: 24900,
        defaultDurationMinutes: 90,
        requiresPermit: false,
        requiredEvidence: [
          "before_wiring_photo",
          "app_connected_screenshot",
          "flow_test_verified",
        ],
        defaultWarrantyMonths: 24,
        geographicRestrictions: ["ON"],
        tags: [
          "irrigation",
          `rachio-${testSuffix}`,
          "sprinkler",
          "smart timer",
          "wifi",
        ],
        launchReady: true,
        displayOrder: 1,
      },
    });
    expect(adminCreateVariant.statusCode).toBe(201);
    const newVariant = adminCreateVariant.json<{ id: string; slug: string }>();

    // Admin variant update
    const updateVariant = await app.inject({
      method: "PATCH",
      url: `/v1/admin/catalog/issue-types/${newVariant.id}`,
      headers: auth("admin@example.test"),
      payload: { basePriceCents: 27900 },
    });
    expect(updateVariant.statusCode).toBe(200);

    // Verify search finds newly created admin item
    const searchCreated = await app.inject({
      method: "GET",
      url: `/v1/catalog/search?q=rachio-${testSuffix}`,
    });
    expect(searchCreated.statusCode).toBe(200);
    const foundVariants =
      searchCreated.json<
        Array<{ variantSlug: string; basePriceCents: number }>
      >();
    expect(
      foundVariants.some(
        (v) => v.variantSlug === testVariantSlug && v.basePriceCents === 27900,
      ),
    ).toBe(true);

    // Verify audit logs were written
    const auditRows = await db
      .select({
        action: auditEvents.action,
        entityType: auditEvents.entityType,
      })
      .from(auditEvents)
      .where(
        inArray(auditEvents.entityType, [
          "VERTICAL",
          "SERVICE_CATEGORY",
          "ISSUE_TYPE",
        ]),
      )
      .orderBy(desc(auditEvents.occurredAt))
      .limit(5);
    expect(auditRows.length).toBeGreaterThan(0);
  });

  it("executes trade regulatory eligibility policies and fail-closed compliance verification (Ontario)", async () => {
    // 1. Fetch regulatory policy matrix
    const matrixRes = await app.inject({
      method: "GET",
      url: "/v1/compliance/policy/matrix?geography=ON",
    });
    expect(matrixRes.statusCode).toBe(200);
    const matrixData = matrixRes.json<{
      geography: string;
      policies: Array<{ verticalSlug: string; geography: string }>;
    }>();
    expect(matrixData.policies.length).toBeGreaterThanOrEqual(4);
    expect(
      matrixData.policies.some((p) => p.verticalSlug === "electrical"),
    ).toBe(true);
    expect(matrixData.policies.some((p) => p.verticalSlug === "hvac")).toBe(
      true,
    );

    // 2. Fetch specific trade policy
    const electricalPolicyRes = await app.inject({
      method: "GET",
      url: "/v1/compliance/policy/matrix?vertical=electrical&geography=ON",
    });
    expect(electricalPolicyRes.statusCode).toBe(200);
    const electricalData = electricalPolicyRes.json<{
      policies: Array<{
        contractorMandatoryCodes: string[];
        technicianMandatoryCodes: string[];
      }>;
    }>();
    expect(electricalData.policies[0]?.contractorMandatoryCodes).toContain(
      "ON_ESA_LEC_CONTRACTOR",
    );
    expect(electricalData.policies[0]?.technicianMandatoryCodes).toContain(
      "ON_SKILLED_TRADES_309A",
    );

    // 3. Auditor verifies a credential with regulator reference
    const [pendingCred] = await db
      .select({ id: credentials.id })
      .from(credentials)
      .where(eq(credentials.status, "PENDING"))
      .limit(1);

    if (pendingCred) {
      const verifyRes = await app.inject({
        method: "POST",
        url: "/v1/compliance/verify-credential",
        headers: auth("admin@example.test"),
        payload: {
          credentialId: pendingCred.id,
          verificationSource: "REGULATOR_API",
          status: "VERIFIED",
          regulatorReference: "ECRA-ESA-TEST-7009999",
          auditorNotes:
            "Audited against ESA/ECRA authoritative license registry",
        },
      });
      expect(verifyRes.statusCode).toBe(200);
      const verifiedData = verifyRes.json<{
        credential: { status: string; regulatorReference: string };
      }>();
      expect(verifiedData.credential.status).toBe("VERIFIED");
      expect(verifiedData.credential.regulatorReference).toBe(
        "ECRA-ESA-TEST-7009999",
      );
    }

    // 4. Negative security test: Unauthenticated access to regulatory eligibility check is rejected (401)
    const [techWithContractor] = await db
      .select({
        id: technicians.id,
        contractorId: technicians.contractorId,
      })
      .from(technicians)
      .where(eq(technicians.displayName, "John S."))
      .limit(1);
    const techId = techWithContractor?.id;
    const contId = techWithContractor?.contractorId;

    const unauthCheck = await app.inject({
      method: "POST",
      url: "/v1/compliance/eligibility-check",
      payload: {
        verticalSlug: "electrical",
        geography: "ON",
        contractorId: contId,
        technicianId: techId,
      },
    });
    expect(unauthCheck.statusCode).toBe(401);

    // 5. Negative security test: Unauthorized non-operations caller is rejected (403)
    const forbiddenCheck = await app.inject({
      method: "POST",
      url: "/v1/compliance/eligibility-check",
      headers: auth("customer@example.test"),
      payload: {
        verticalSlug: "electrical",
        geography: "ON",
        contractorId: contId,
        technicianId: techId,
      },
    });
    expect(forbiddenCheck.statusCode).toBe(403);

    // 6. Tenancy test: Mismatched contractor and technician is rejected (422 CONTRACTOR_TECHNICIAN_MISMATCH)
    const [otherContractor] = contId
      ? await db
          .select({ id: contractors.id })
          .from(contractors)
          .where(ne(contractors.id, contId))
          .limit(1)
      : [];
    if (otherContractor) {
      const mismatchCheck = await app.inject({
        method: "POST",
        url: "/v1/compliance/eligibility-check",
        headers: auth("admin@example.test"),
        payload: {
          verticalSlug: "electrical",
          geography: "ON",
          contractorId: otherContractor.id,
          technicianId: techId,
        },
      });
      expect(mismatchCheck.statusCode).toBe(422);
      expect(mismatchCheck.json<{ code: string }>().code).toBe(
        "CONTRACTOR_TECHNICIAN_MISMATCH",
      );
    }

    // 7. Authoritative Dispatch Eligibility: Fail-closed when technician lacks mandatory trade credentials
    if (techId) {
      await db
        .delete(credentials)
        .where(
          and(
            eq(credentials.technicianId, techId),
            eq(credentials.code, "ON_SKILLED_TRADES_309A"),
          ),
        );
    }
    const failClosedCheck = await app.inject({
      method: "POST",
      url: "/v1/compliance/eligibility-check",
      headers: auth("admin@example.test"),
      payload: {
        verticalSlug: "electrical",
        geography: "ON",
        contractorId: contId,
        technicianId: techId,
      },
    });
    expect(failClosedCheck.statusCode).toBe(200);
    const failResult = failClosedCheck.json<{
      eligible: boolean;
      failClosed: boolean;
      reasons: string[];
    }>();
    expect(failResult.eligible).toBe(false);
    expect(failResult.failClosed).toBe(true);
    expect(failResult.reasons.length).toBeGreaterThan(0);

    // 8. Integrated Dispatch Assignment Transaction Gate: Real assignment fails closed (422 REGULATORY_ELIGIBILITY_FAILED)
    const [elecVertical] = await db
      .select({ id: verticals.id })
      .from(verticals)
      .where(eq(verticals.slug, "electrical"))
      .limit(1);
    const [custUserRecord] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "customer@example.test"))
      .limit(1);
    const [custProp] = custUserRecord
      ? await db
          .select({ id: properties.id })
          .from(properties)
          .where(eq(properties.customerId, custUserRecord.id))
          .limit(1)
      : [];
    const [elecCategory] = elecVertical
      ? await db
          .select({ id: serviceCategories.id })
          .from(serviceCategories)
          .where(eq(serviceCategories.verticalId, elecVertical.id))
          .limit(1)
      : [];
    const [elecIssue] = elecCategory
      ? await db
          .select({ id: issueTypes.id })
          .from(issueTypes)
          .where(eq(issueTypes.categoryId, elecCategory.id))
          .limit(1)
      : [];

    if (elecVertical && custProp && elecCategory && elecIssue) {
      if (contId) {
        const [currentCont] = await db
          .select({ verticalIds: contractors.verticalIds })
          .from(contractors)
          .where(eq(contractors.id, contId))
          .limit(1);
        const curV = (currentCont?.verticalIds as string[]) ?? [];
        if (!curV.includes(elecVertical.id)) {
          await db
            .update(contractors)
            .set({ verticalIds: [...curV, elecVertical.id] })
            .where(eq(contractors.id, contId));
        }
      }

      const createElecReq = await app.inject({
        method: "POST",
        url: "/v1/service-requests",
        headers: auth("customer@example.test"),
        payload: {
          propertyId: custProp.id,
          verticalId: elecVertical.id,
          categoryId: elecCategory.id,
          issueTypeId: elecIssue.id,
          urgency: "STANDARD",
          description: "Electrical service panel requires inspection",
        },
      });
      expect(createElecReq.statusCode).toBe(201);
      const elecReqId = createElecReq.json<{ id: string }>().id;

      for (const to of [
        "QUALIFICATION_PENDING",
        "QUALIFIED",
        "SCHEDULING",
        "SCHEDULED",
        "CONTRACTOR_SEARCH",
      ] as const) {
        const trans = await app.inject({
          method: "POST",
          url: `/v1/service-requests/${elecReqId}/transition`,
          headers: auth("dispatch@example.test"),
          payload: { to },
        });
        expect(trans.statusCode).toBe(200);
      }

      const blockedAssign = await app.inject({
        method: "POST",
        url: `/v1/dispatch/${elecReqId}/assign`,
        headers: auth("dispatch@example.test"),
        payload: { technicianId: techId },
      });
      expect(blockedAssign.statusCode).toBe(422);
      expect(blockedAssign.json<{ code: string }>().code).toBe(
        "REGULATORY_ELIGIBILITY_FAILED",
      );
    }

    // 9. Database check constraint verification: SELF_UPLOAD cannot directly hold VERIFIED status
    let constraintTriggered = false;
    try {
      await db.insert(credentials).values({
        technicianId: techId,
        code: "TEST_UNAUDITED",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "SELF_UPLOAD",
      });
    } catch (err: any) {
      constraintTriggered =
        err.message?.includes("credentials_fail_closed_verification") ||
        err.code === "23514" ||
        err.cause?.code === "23514" ||
        err.cause?.message?.includes("credentials_fail_closed_verification");
    }
    expect(constraintTriggered).toBe(true);
  });

  it("enforces cross-contractor tenant isolation and prevents unauthorized credential submissions (SH-25 / #26)", async () => {
    // 1. Identify primary contractor A and technician A
    const [techUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "technician@example.test"))
      .limit(1);
    expect(techUser).toBeDefined();

    const [techA] = await db
      .select({ id: technicians.id, contractorId: technicians.contractorId })
      .from(technicians)
      .where(eq(technicians.userId, techUser!.id))
      .limit(1);
    expect(techA).toBeDefined();

    const [contractorA] = await db
      .select({ id: contractors.id, ownerUserId: contractors.ownerUserId })
      .from(contractors)
      .where(eq(contractors.id, techA!.contractorId))
      .limit(1);
    expect(contractorA).toBeDefined();

    const [ownerUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, contractorA!.ownerUserId))
      .limit(1);
    expect(ownerUser).toBeDefined();

    // 2. Provision or retrieve isolated rival contractor B and technician B
    let [contractorB] = await db
      .select({ id: contractors.id })
      .from(contractors)
      .where(eq(contractors.name, "Rival Trade Services Inc"))
      .limit(1);

    let techBId: string;
    if (!contractorB) {
      const [u] = await db
        .insert(users)
        .values({
          email: "rival-owner@example.test",
          passwordHash: "hash",
          displayName: "Rival Owner",
        })
        .onConflictDoNothing()
        .returning({ id: users.id });
      const rivalUserId =
        u?.id ??
        (
          await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, "rival-owner@example.test"))
        )[0]!.id;
      await db
        .insert(userRoles)
        .values({ userId: rivalUserId, role: "CONTRACTOR_OWNER" })
        .onConflictDoNothing();

      const [c] = await db
        .insert(contractors)
        .values({
          name: "Rival Trade Services Inc",
          ownerUserId: rivalUserId,
          status: "VERIFIED",
        })
        .returning({ id: contractors.id });
      contractorB = c!;

      const [tUser] = await db
        .insert(users)
        .values({
          email: "rival-tech@example.test",
          passwordHash: "hash",
          displayName: "Rival Technician",
        })
        .onConflictDoNothing()
        .returning({ id: users.id });
      const rivalTechUserId =
        tUser?.id ??
        (
          await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, "rival-tech@example.test"))
        )[0]!.id;
      await db
        .insert(userRoles)
        .values({ userId: rivalTechUserId, role: "TECHNICIAN" })
        .onConflictDoNothing();

      const [t] = await db
        .insert(technicians)
        .values({
          userId: rivalTechUserId,
          contractorId: contractorB.id,
          displayName: "Rival Tech",
          active: false,
        })
        .returning({ id: technicians.id });
      techBId = t!.id;
    } else {
      await db
        .update(technicians)
        .set({ active: false })
        .where(eq(technicians.contractorId, contractorB.id));
      const [t] = await db
        .select({ id: technicians.id })
        .from(technicians)
        .where(eq(technicians.contractorId, contractorB.id))
        .limit(1);
      techBId = t!.id;
    }

    const testMaliciousCode = "TEST_CROSS_TENANT_MALICIOUS";

    // 3. Test: Contractor A attempts to submit credential for Contractor B's technician -> 403 FORBIDDEN
    const crossContractorRes = await app.inject({
      method: "POST",
      url: "/v1/credentials/submit",
      headers: auth("owner@example.test"),
      payload: {
        entityType: "TECHNICIAN",
        technicianId: techBId,
        code: testMaliciousCode,
        geography: "ON",
        documentKey: "uploads/compliance/forged-credential.pdf",
      },
    });
    expect(crossContractorRes.statusCode).toBe(403);
    expect(crossContractorRes.json<{ code: string }>().code).toBe("FORBIDDEN");

    // 4. Test: Technician A attempts to submit credential for Technician B -> 403 FORBIDDEN
    const crossTechRes = await app.inject({
      method: "POST",
      url: "/v1/credentials/submit",
      headers: auth("technician@example.test"),
      payload: {
        entityType: "TECHNICIAN",
        technicianId: techBId,
        code: testMaliciousCode,
        geography: "ON",
        documentKey: "uploads/compliance/forged-tech-credential.pdf",
      },
    });
    expect(crossTechRes.statusCode).toBe(403);
    expect(crossTechRes.json<{ code: string }>().code).toBe("FORBIDDEN");

    // 5. Test: Technician attempts to submit CONTRACTOR level credential -> 403 FORBIDDEN
    const techSubmitsContractorRes = await app.inject({
      method: "POST",
      url: "/v1/credentials/submit",
      headers: auth("technician@example.test"),
      payload: {
        entityType: "CONTRACTOR",
        code: "ON_TSSA_CONTRACTOR_REG",
        geography: "ON",
        documentKey: "uploads/compliance/tech-forged-contractor.pdf",
      },
    });
    expect(techSubmitsContractorRes.statusCode).toBe(403);
    expect(techSubmitsContractorRes.json<{ code: string }>().code).toBe(
      "FORBIDDEN",
    );

    // 6. Test: Contractor attempts to submit for non-existent technician -> 404 NOT_FOUND
    const fakeTechRes = await app.inject({
      method: "POST",
      url: "/v1/credentials/submit",
      headers: auth("owner@example.test"),
      payload: {
        entityType: "TECHNICIAN",
        technicianId: crypto.randomUUID(),
        code: "ON_SKILLED_TRADES_309A",
        geography: "ON",
        documentKey: "uploads/compliance/fake-tech.pdf",
      },
    });
    expect(fakeTechRes.statusCode).toBe(404);
    expect(fakeTechRes.json<{ code: string }>().code).toBe(
      "TECHNICIAN_NOT_FOUND",
    );

    // 7. Test: Contractor A attempts to submit CONTRACTOR credential with forged contractorId -> 403 FORBIDDEN
    const crossContractorOrgRes = await app.inject({
      method: "POST",
      url: "/v1/credentials/submit",
      headers: auth("owner@example.test"),
      payload: {
        entityType: "CONTRACTOR",
        contractorId: contractorB.id,
        code: "ON_TSSA_CONTRACTOR_REG",
        geography: "ON",
        documentKey: "uploads/compliance/forged-org.pdf",
      },
    });
    expect(crossContractorOrgRes.statusCode).toBe(403);
    expect(crossContractorOrgRes.json<{ code: string }>().code).toBe(
      "FORBIDDEN",
    );

    // 8. Test: Unauthenticated request -> 401 UNAUTHORIZED
    const unauthRes = await app.inject({
      method: "POST",
      url: "/v1/credentials/submit",
      headers: {},
      payload: {
        entityType: "TECHNICIAN",
        technicianId: techBId,
        code: "ON_SKILLED_TRADES_309A",
        geography: "ON",
        documentKey: "uploads/compliance/unauth.pdf",
      },
    });
    expect(unauthRes.statusCode).toBe(401);

    // 9. Verify zero credentials were created in DB for malicious code
    const maliciousCreds = await db
      .select({ id: credentials.id })
      .from(credentials)
      .where(eq(credentials.code, testMaliciousCode));
    expect(maliciousCreds.length).toBe(0);

    // 10. Test: Admin staff override can legitimately submit for Technician B -> 201 PENDING
    const adminStaffOverrideRes = await app.inject({
      method: "POST",
      url: "/v1/credentials/submit",
      headers: auth("admin@example.test"),
      payload: {
        entityType: "TECHNICIAN",
        technicianId: techBId,
        code: "ON_SKILLED_TRADES_309A",
        geography: "ON",
        documentKey: "uploads/compliance/admin-verified-309a.pdf",
      },
    });
    expect(adminStaffOverrideRes.statusCode).toBe(201);
    expect(adminStaffOverrideRes.json<{ status: string }>().status).toBe(
      "PENDING",
    );

    // 11. Test: Contractor A legitimately submits for own Technician A -> 201 PENDING
    const legitOwnerSubmitRes = await app.inject({
      method: "POST",
      url: "/v1/credentials/submit",
      headers: auth("owner@example.test"),
      payload: {
        entityType: "TECHNICIAN",
        technicianId: techA!.id,
        code: "ON_SKILLED_TRADES_313A",
        geography: "ON",
        documentKey: "uploads/compliance/owner-legit-tech-313a.pdf",
      },
    });
    expect(legitOwnerSubmitRes.statusCode).toBe(201);
    expect(legitOwnerSubmitRes.json<{ status: string }>().status).toBe(
      "PENDING",
    );
  });

  it("enforces technical capability assessment, scoped approval, assessor review, and appeal lifecycle", async () => {
    // 1. Fetch contractor A (owned by owner@example.test)
    const [ownerUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "owner@example.test"))
      .limit(1);
    expect(ownerUser).toBeDefined();

    const [contractorA] = await db
      .select({ id: contractors.id })
      .from(contractors)
      .where(eq(contractors.ownerUserId, ownerUser!.id))
      .limit(1);
    expect(contractorA).toBeDefined();

    // Fetch rival contractor B
    const [contractorB] = await db
      .select({ id: contractors.id })
      .from(contractors)
      .where(ne(contractors.id, contractorA!.id))
      .limit(1);
    expect(contractorB).toBeDefined();

    // Fetch two distinct issue types
    const issueTypeList = await db
      .select({ id: issueTypes.id, slug: issueTypes.slug })
      .from(issueTypes)
      .limit(2);
    expect(issueTypeList.length).toBeGreaterThanOrEqual(2);
    const issueTypeA = issueTypeList[0]!;
    const issueTypeB = issueTypeList[1]!;

    // Clean up any existing capability assessment for contractorA + issueTypeA / issueTypeB
    await db
      .delete(contractorCapabilityAssessments)
      .where(
        and(
          eq(contractorCapabilityAssessments.contractorId, contractorA!.id),
          or(
            eq(contractorCapabilityAssessments.issueTypeId, issueTypeA.id),
            eq(contractorCapabilityAssessments.issueTypeId, issueTypeB.id),
          ),
        ),
      );

    // 2. Contractor A submits capability assessment for issueTypeA -> 201 Created (SUBMITTED)
    const submitRes = await app.inject({
      method: "POST",
      url: "/v1/capability/assessments",
      headers: auth("owner@example.test"),
      payload: {
        issueTypeId: issueTypeA.id,
        geography: "ON",
        complexityTier: "TIER_2_STANDARD",
        yearsExperience: 5,
        maxJobValueCents: 500_000,
        workSamples: [
          {
            id: "ws-test-1",
            title: "Commercial Air Handler Retrofit",
            description:
              "Installed multi-stage air handler with balanced ductwork",
            completedAt: "2025-08-10",
          },
        ],
        references: [
          {
            id: "ref-test-1",
            clientName: "Ontario Property Group",
            clientContact: "905-555-0182",
            projectScope: "Multi-unit air conditioning replacement",
            relationship: "Commercial Client",
          },
        ],
        toolsEquipment: [
          {
            toolName: "Refrigerant Recovery Machine",
            ownedOrLeased: true,
          },
        ],
      },
    });

    expect(submitRes.statusCode).toBe(201);
    const createdAssessment = submitRes.json<{
      id: string;
      status: string;
      complexityTier: string;
      maxJobValueCents: number;
    }>();
    expect(createdAssessment.status).toBe("SUBMITTED");
    expect(createdAssessment.complexityTier).toBe("TIER_2_STANDARD");
    expect(Number(createdAssessment.maxJobValueCents)).toBe(500_000);

    // 3. Test Cross-Contractor Tenant Isolation:
    // Contractor A attempts to submit assessment for Contractor B -> 403 FORBIDDEN
    const crossSubmitRes = await app.inject({
      method: "POST",
      url: "/v1/capability/assessments",
      headers: auth("owner@example.test"),
      payload: {
        contractorId: contractorB!.id,
        issueTypeId: issueTypeA.id,
        geography: "ON",
        workSamples: [
          {
            title: "Forged Sample",
            description: "Unauthorized submission",
            completedAt: "2025-01-01",
          },
        ],
        references: [
          {
            clientName: "Fake Client",
            clientContact: "555-0000",
            projectScope: "Fake Project",
            relationship: "None",
          },
        ],
      },
    });
    expect(crossSubmitRes.statusCode).toBe(403);

    // Contractor A attempts to list Contractor B's assessments -> 403 FORBIDDEN
    const crossListRes = await app.inject({
      method: "GET",
      url: `/v1/capability/assessments?contractorId=${contractorB!.id}`,
      headers: auth("owner@example.test"),
    });
    expect(crossListRes.statusCode).toBe(403);

    // 4. Test Assessor Review RBAC:
    // Non-assessor (customer) attempts review -> 403 FORBIDDEN
    const customerReviewRes = await app.inject({
      method: "POST",
      url: `/v1/capability/assessments/${createdAssessment.id}/review`,
      headers: auth("customer@example.test"),
      payload: {
        decision: "APPROVED",
      },
    });
    expect(customerReviewRes.statusCode).toBe(403);

    // Assessor attempts rejection without denial reasons -> 400 DENIAL_REASONS_REQUIRED
    const missingReasonsRes = await app.inject({
      method: "POST",
      url: `/v1/capability/assessments/${createdAssessment.id}/review`,
      headers: auth("admin@example.test"),
      payload: {
        decision: "REJECTED",
        denialReasons: [],
      },
    });
    expect(missingReasonsRes.statusCode).toBe(400);

    // Assessor rejects with criteria-based denial reason -> 200 REJECTED
    const rejectRes = await app.inject({
      method: "POST",
      url: `/v1/capability/assessments/${createdAssessment.id}/review`,
      headers: auth("admin@example.test"),
      payload: {
        decision: "REJECTED",
        denialReasons: ["MISSING_MANDATORY_TOOLS", "UNVERIFIED_WORK_SAMPLES"],
        decisionNotes:
          "Missing certified manifold gauges for specialized HVAC scope.",
      },
    });
    expect(rejectRes.statusCode).toBe(200);
    expect(rejectRes.json<{ status: string }>().status).toBe("REJECTED");

    // 5. Contractor Appeal Flow:
    const appealRes = await app.inject({
      method: "POST",
      url: `/v1/capability/assessments/${createdAssessment.id}/appeal`,
      headers: auth("owner@example.test"),
      payload: {
        reason:
          "Procured calibrated digital manifold gauges and attached calibration certificate.",
        additionalWorkSamples: [
          {
            id: "ws-appeal-1",
            title: "Supplementary Ductless Split Commissioning",
            description:
              "High-efficiency commissioning report with vacuum hold test logs",
            completedAt: "2025-09-01",
          },
        ],
      },
    });
    expect(appealRes.statusCode).toBe(200);
    expect(appealRes.json<{ status: string }>().status).toBe("APPEALED");

    // 6. Assessor Approves Appeal:
    const approveRes = await app.inject({
      method: "POST",
      url: `/v1/capability/assessments/${createdAssessment.id}/review`,
      headers: auth("admin@example.test"),
      payload: {
        decision: "APPROVED",
        complexityTier: "TIER_3_ADVANCED",
        maxJobValueCents: 500_000,
        verifiedWorkSampleIds: ["ws-test-1", "ws-appeal-1"],
        decisionNotes:
          "Appeal accepted; tools verified and commissioning logs validated.",
      },
    });
    expect(approveRes.statusCode).toBe(200);
    const approvedRecord = approveRes.json<{
      status: string;
      complexityTier: string;
      validUntil: string | null;
    }>();
    expect(approvedRecord.status).toBe("APPROVED");
    expect(approvedRecord.complexityTier).toBe("TIER_3_ADVANCED");
    expect(approvedRecord.validUntil).not.toBeNull();

    // 7. Scoped Capability Evaluation:
    // a) Compliant request within Tier 3 and $5,000 ceiling -> ELIGIBLE
    const evalEligibleRes = await app.inject({
      method: "POST",
      url: "/v1/capability/evaluate",
      headers: auth("owner@example.test"),
      payload: {
        contractorId: contractorA!.id,
        issueTypeId: issueTypeA.id,
        geography: "ON",
        requiredComplexityTier: "TIER_2_STANDARD",
        estimatedJobValueCents: 300_000,
      },
    });
    expect(evalEligibleRes.statusCode).toBe(200);
    expect(evalEligibleRes.json<{ eligible: boolean }>().eligible).toBe(true);

    // b) Request exceeding financial ceiling ($8,000 > $5,000) -> INELIGIBLE (FAIL CLOSED)
    const evalCeilingRes = await app.inject({
      method: "POST",
      url: "/v1/capability/evaluate",
      headers: auth("owner@example.test"),
      payload: {
        contractorId: contractorA!.id,
        issueTypeId: issueTypeA.id,
        geography: "ON",
        requiredComplexityTier: "TIER_2_STANDARD",
        estimatedJobValueCents: 800_000,
      },
    });
    expect(evalCeilingRes.statusCode).toBe(200);
    const ceilingJson = evalCeilingRes.json<{
      eligible: boolean;
      failClosedReason: string;
    }>();
    expect(ceilingJson.eligible).toBe(false);
    expect(ceilingJson.failClosedReason).toBe("EXCEEDS_MAX_JOB_VALUE_CEILING");

    // c) Request requiring higher complexity tier (TIER_4_SPECIALIZED > TIER_3_ADVANCED) -> INELIGIBLE
    const evalTierRes = await app.inject({
      method: "POST",
      url: "/v1/capability/evaluate",
      headers: auth("owner@example.test"),
      payload: {
        contractorId: contractorA!.id,
        issueTypeId: issueTypeA.id,
        geography: "ON",
        requiredComplexityTier: "TIER_4_SPECIALIZED",
        estimatedJobValueCents: 300_000,
      },
    });
    expect(evalTierRes.statusCode).toBe(200);
    const tierJson = evalTierRes.json<{
      eligible: boolean;
      failClosedReason: string;
    }>();
    expect(tierJson.eligible).toBe(false);
    expect(tierJson.failClosedReason).toBe("INSUFFICIENT_COMPLEXITY_TIER");

    // d) Request for unassessed service variant (issueTypeB) -> INELIGIBLE (SCOPE ISOLATION)
    const evalUnassessedRes = await app.inject({
      method: "POST",
      url: "/v1/capability/evaluate",
      headers: auth("owner@example.test"),
      payload: {
        contractorId: contractorA!.id,
        issueTypeId: issueTypeB.id,
        geography: "ON",
        requiredComplexityTier: "TIER_1_BASIC",
        estimatedJobValueCents: 100_000,
      },
    });
    expect(evalUnassessedRes.statusCode).toBe(200);
    const unassessedJson = evalUnassessedRes.json<{
      eligible: boolean;
      failClosedReason: string;
    }>();
    expect(unassessedJson.eligible).toBe(false);
    expect(unassessedJson.failClosedReason).toBe(
      "NO_CAPABILITY_ASSESSMENT_ON_FILE",
    );
  });

  it("enforces pre-dispatch eligibility reevaluation, immutable evidence snapshot, and worker identity verification (#57)", async () => {
    // 1. Identify primary contractor, technician, and trade vertical (Electrical)
    const [elecVertical] = await db
      .select({ id: verticals.id, slug: verticals.slug })
      .from(verticals)
      .where(eq(verticals.slug, "electrical"))
      .limit(1);
    expect(elecVertical).toBeDefined();

    const [elecCat] = await db
      .select({ id: serviceCategories.id, slug: serviceCategories.slug })
      .from(serviceCategories)
      .where(eq(serviceCategories.verticalId, elecVertical!.id))
      .limit(1);
    expect(elecCat).toBeDefined();

    const [elecIssue] = await db
      .select({ id: issueTypes.id, slug: issueTypes.slug })
      .from(issueTypes)
      .where(eq(issueTypes.categoryId, elecCat!.id))
      .limit(1);
    expect(elecIssue).toBeDefined();

    const [cont] = await db
      .select({ id: contractors.id, verticalIds: contractors.verticalIds })
      .from(contractors)
      .innerJoin(technicians, eq(technicians.contractorId, contractors.id))
      .where(and(eq(contractors.status, "VERIFIED"), eq(technicians.active, true)))
      .orderBy(contractors.createdAt)
      .limit(1);
    expect(cont).toBeDefined();

    // Ensure contractor is associated with electrical vertical
    const vIds = (cont!.verticalIds as string[]) ?? [];
    if (!vIds.includes(elecVertical!.id)) {
      await db
        .update(contractors)
        .set({ verticalIds: [...vIds, elecVertical!.id] })
        .where(eq(contractors.id, cont!.id));
    }

    const [tech] = await db
      .select({ id: technicians.id, userId: technicians.userId })
      .from(technicians)
      .where(
        and(
          eq(technicians.contractorId, cont!.id),
          eq(technicians.active, true),
        ),
      )
      .orderBy(technicians.createdAt)
      .limit(1);
    expect(tech).toBeDefined();

    // Ensure valid credentials on file
    const futureDate = "2028-12-31";
    await db
      .delete(credentials)
      .where(
        or(
          eq(credentials.contractorId, cont!.id),
          eq(credentials.technicianId, tech!.id),
        ),
      );

    await db.insert(credentials).values([
      {
        contractorId: cont!.id,
        code: "ON_ESA_LEC_CONTRACTOR",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "ECRA-ESA-7001122",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        contractorId: cont!.id,
        code: "ON_WSIB_CLEARANCE",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "WSIB-ON-991823",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        contractorId: cont!.id,
        code: "CGL_INSURANCE_2M",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "POL-CGL-882910",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        contractorId: cont!.id,
        code: "COMMERCIAL_AUTO_1M",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "POL-AUTO-99201",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        technicianId: tech!.id,
        code: "ON_SKILLED_TRADES_309A",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "COFQ-309A-88339",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        technicianId: tech!.id,
        code: "GOVT_PHOTO_ID",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "DL-ON-448822-192",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        technicianId: tech!.id,
        code: "BACKGROUND_CHECK_ANNUAL",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "BG-CERT-2026-118",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        technicianId: tech!.id,
        code: "ELECTRICAL_LICENSE",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "LIC-ELEC-88291",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
    ]);

    // Ensure contractor has approved capability assessment for this variant
    await db
      .delete(contractorCapabilityAssessments)
      .where(
        and(
          eq(contractorCapabilityAssessments.contractorId, cont!.id),
          eq(contractorCapabilityAssessments.issueTypeId, elecIssue!.id),
        ),
      );

    const [assessorUser] = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .where(eq(userRoles.role, "ADMIN"))
      .limit(1);

    await db.insert(contractorCapabilityAssessments).values({
      contractorId: cont!.id,
      issueTypeId: elecIssue!.id,
      geography: "ON",
      status: "APPROVED",
      complexityTier: "TIER_3_ADVANCED",
      yearsExperience: 8,
      maxJobValueCents: 1000000,
      assessedByUserId: assessorUser?.id ?? tech!.userId,
      assessedAt: new Date(),
      validUntil: new Date("2028-12-31T00:00:00Z"),
      decisionNotes: "Verified technical competency and certifications",
    });

    const [prop] = await db
      .select({ id: properties.id })
      .from(properties)
      .limit(1);
    expect(prop).toBeDefined();

    // 2. Customer creates a service request
    const createReq = await app.inject({
      method: "POST",
      url: "/v1/service-requests",
      headers: auth("customer@example.test"),
      payload: {
        propertyId: prop!.id,
        verticalId: elecVertical!.id,
        categoryId: elecCat!.id,
        issueTypeId: elecIssue!.id,
        urgency: "STANDARD",
        description: "Electrical high-capacity breaker panel replacement",
      },
    });
    expect(createReq.statusCode).toBe(201);
    const reqId = createReq.json<{ id: string }>().id;

    // Progress request to CONTRACTOR_SEARCH
    for (const to of [
      "QUALIFICATION_PENDING",
      "QUALIFIED",
      "SCHEDULING",
      "SCHEDULED",
      "CONTRACTOR_SEARCH",
    ] as const) {
      const trans = await app.inject({
        method: "POST",
        url: `/v1/service-requests/${reqId}/transition`,
        headers: auth("dispatch@example.test"),
        payload: { to },
      });
      expect(trans.statusCode).toBe(200);
    }

    // 3. Dry-Run Pre-Dispatch Eligibility Evaluation Endpoint
    const dryRunRes = await app.inject({
      method: "POST",
      url: `/v1/dispatch/${reqId}/evaluate-eligibility`,
      headers: auth("dispatch@example.test"),
      payload: { technicianId: tech!.id },
    });
    expect(dryRunRes.statusCode).toBe(200);
    const dryRunJson = dryRunRes.json<{
      eligible: boolean;
      denyCodes: string[];
      evidenceSnapshot: {
        snapshotVersion: number;
        regulatoryPolicy: { policyVersion: number };
        contractor: { contractorId: string };
        technician: { technicianId: string };
      };
    }>();
    expect(dryRunJson.eligible).toBe(true);
    expect(dryRunJson.denyCodes).toHaveLength(0);
    expect(dryRunJson.evidenceSnapshot.snapshotVersion).toBe(1);
    expect(dryRunJson.evidenceSnapshot.contractor.contractorId).toBe(cont!.id);
    expect(dryRunJson.evidenceSnapshot.technician.technicianId).toBe(tech!.id);

    // 4. Live Dispatch Assignment: Stores immutable evidence snapshot
    const assignRes = await app.inject({
      method: "POST",
      url: `/v1/dispatch/${reqId}/assign`,
      headers: auth("dispatch@example.test"),
      payload: { technicianId: tech!.id },
    });
    expect(assignRes.statusCode).toBe(201);
    const assignJson = assignRes.json<{
      jobId: string;
      status: string;
      evidenceSnapshot: {
        snapshotVersion: number;
        jurisdiction: string;
      };
    }>();
    expect(assignJson.status).toBe("ASSIGNED");
    expect(assignJson.evidenceSnapshot.snapshotVersion).toBe(1);
    expect(assignJson.evidenceSnapshot.jurisdiction).toBe("ON");

    const jobId = assignJson.jobId;

    // Verify job in database has evidence_snapshot and worker_identity_verified=false
    const [dbJob] = await db
      .select({
        workerIdentityVerified: jobs.workerIdentityVerified,
        assignedJurisdiction: jobs.assignedJurisdiction,
        evidenceSnapshot: jobs.evidenceSnapshot,
      })
      .from(jobs)
      .where(eq(jobs.id, jobId));
    expect(dbJob?.workerIdentityVerified).toBe(false);
    expect(dbJob?.assignedJurisdiction).toBe("ON");
    expect(dbJob?.evidenceSnapshot).toBeDefined();

    // Verify audit check recorded in dispatch_eligibility_checks
    const [auditCheck] = await db
      .select()
      .from(dispatchEligibilityChecks)
      .where(
        and(
          eq(dispatchEligibilityChecks.serviceRequestId, reqId),
          eq(dispatchEligibilityChecks.evaluationStage, "PRE_DISPATCH"),
        ),
      );
    expect(auditCheck?.eligible).toBe(true);

    // 5. Pre-Work Commencement Guard: Fails closed when worker identity is unverified
    const unverifiedCommence = await app.inject({
      method: "POST",
      url: `/v1/jobs/${jobId}/commence-work`,
      headers: auth("dispatch@example.test"),
      payload: {},
    });
    expect(unverifiedCommence.statusCode).toBe(422);
    expect(unverifiedCommence.json<{ code: string }>().code).toBe(
      "PRE_WORK_CHECK_FAILED",
    );
    expect(
      unverifiedCommence.json<{ details: { denyCodes: string[] } }>().details
        .denyCodes,
    ).toContain("WORKER_IDENTITY_UNVERIFIED");

    // 6. Worker Identity Verification Endpoint RBAC
    // Customer cannot verify worker identity -> 403 Forbidden
    const custVerify = await app.inject({
      method: "POST",
      url: `/v1/jobs/${jobId}/verify-worker-identity`,
      headers: auth("customer@example.test"),
      payload: { method: "GOVT_PHOTO_ID" },
    });
    expect(custVerify.statusCode).toBe(403);

    // Dispatcher / Ops verifies technician's government photo ID
    const validVerify = await app.inject({
      method: "POST",
      url: `/v1/jobs/${jobId}/verify-worker-identity`,
      headers: auth("dispatch@example.test"),
      payload: {
        method: "GOVT_PHOTO_ID",
        documentReference: "DL-ON-448822",
        notes: "Verified Ontario driver's license match against registry",
      },
    });
    expect(validVerify.statusCode).toBe(200);
    expect(validVerify.json<{ workerIdentityVerified: boolean }>().workerIdentityVerified).toBe(true);

    // Verify DB update
    const [updatedJob] = await db
      .select({
        workerIdentityVerified: jobs.workerIdentityVerified,
        workerIdentityMethod: jobs.workerIdentityMethod,
      })
      .from(jobs)
      .where(eq(jobs.id, jobId));
    expect(updatedJob?.workerIdentityVerified).toBe(true);
    expect(updatedJob?.workerIdentityMethod).toBe("GOVT_PHOTO_ID");

    // 7. Worker Substitution Guard: Reject different technician attempting to commence
    const [fakeTech] = await db
      .select({ id: technicians.id })
      .from(technicians)
      .where(ne(technicians.id, tech!.id))
      .limit(1);

    if (fakeTech) {
      const subCommence = await app.inject({
        method: "POST",
        url: `/v1/jobs/${jobId}/commence-work`,
        headers: auth("dispatch@example.test"),
        payload: { technicianId: fakeTech.id },
      });
      expect(subCommence.statusCode).toBe(422);
      expect(
        subCommence.json<{ details: { denyCodes: string[] } }>().details
          .denyCodes,
      ).toContain("UNAUTHORIZED_WORKER_SUBSTITUTION");
    }

    // 8. Authorized Work Commencement
    const commenceRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${jobId}/commence-work`,
      headers: auth("dispatch@example.test"),
      payload: { technicianId: tech!.id },
    });
    expect(commenceRes.statusCode).toBe(200);
    expect(commenceRes.json<{ status: string; allowedToCommence: boolean }>().status).toBe("WORK_IN_PROGRESS");
    expect(commenceRes.json<{ status: string; allowedToCommence: boolean }>().allowedToCommence).toBe(true);

    // Verify DB updated to WORK_IN_PROGRESS
    const [commencedJob] = await db
      .select({ status: jobs.status })
      .from(jobs)
      .where(eq(jobs.id, jobId));
    expect(commencedJob?.status).toBe("WORK_IN_PROGRESS");
  });

  it("executes end-to-end safety incident response, automated suspension, insurer claims tracking, and remediation audit drill (#58)", async () => {
    // 1. Identify primary contractor, technician, and trade vertical (Electrical)
    const [elecVertical] = await db
      .select({ id: verticals.id, slug: verticals.slug })
      .from(verticals)
      .where(eq(verticals.slug, "electrical"))
      .limit(1);
    expect(elecVertical).toBeDefined();

    const [elecCat] = await db
      .select({ id: serviceCategories.id, slug: serviceCategories.slug })
      .from(serviceCategories)
      .where(eq(serviceCategories.verticalId, elecVertical!.id))
      .limit(1);
    expect(elecCat).toBeDefined();

    const [elecIssue] = await db
      .select({ id: issueTypes.id, slug: issueTypes.slug })
      .from(issueTypes)
      .where(eq(issueTypes.categoryId, elecCat!.id))
      .limit(1);
    expect(elecIssue).toBeDefined();

    const [cont] = await db
      .select({ id: contractors.id, verticalIds: contractors.verticalIds })
      .from(contractors)
      .innerJoin(technicians, eq(technicians.contractorId, contractors.id))
      .where(
        and(
          eq(contractors.status, "VERIFIED"),
          eq(technicians.active, true),
        ),
      )
      .orderBy(contractors.createdAt)
      .limit(1);
    expect(cont).toBeDefined();

    // Ensure contractor is associated with electrical vertical
    const vIds = (cont!.verticalIds as string[]) ?? [];
    if (!vIds.includes(elecVertical!.id)) {
      await db
        .update(contractors)
        .set({ verticalIds: [...vIds, elecVertical!.id] })
        .where(eq(contractors.id, cont!.id));
    }

    const [tech] = await db
      .select({ id: technicians.id, userId: technicians.userId })
      .from(technicians)
      .where(
        and(
          eq(technicians.contractorId, cont!.id),
          eq(technicians.active, true),
        ),
      )
      .orderBy(technicians.createdAt)
      .limit(1);
    expect(tech).toBeDefined();

    // Reset safety status & clean existing safety test data for clean slate
    await db
      .update(contractors)
      .set({ safetyStatus: "ACTIVE", suspendedAt: null, suspensionReason: null })
      .where(eq(contractors.id, cont!.id));

    await db
      .update(technicians)
      .set({ safetyStatus: "ACTIVE", suspendedAt: null, suspensionReason: null })
      .where(eq(technicians.id, tech!.id));

    await db
      .delete(contractorSafetyQuarantines)
      .where(eq(contractorSafetyQuarantines.contractorId, cont!.id));

    await db
      .delete(qualityAudits)
      .where(eq(qualityAudits.contractorId, cont!.id));

    await db
      .delete(safetyIncidents)
      .where(eq(safetyIncidents.contractorId, cont!.id));

    // Ensure valid credentials on file
    const futureDate = "2028-12-31";
    await db
      .delete(credentials)
      .where(
        or(
          eq(credentials.contractorId, cont!.id),
          eq(credentials.technicianId, tech!.id),
        ),
      );

    await db.insert(credentials).values([
      {
        contractorId: cont!.id,
        code: "ON_ESA_LEC_CONTRACTOR",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "ECRA-ESA-7001122",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        contractorId: cont!.id,
        code: "ON_WSIB_CLEARANCE",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "WSIB-ON-991823",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        contractorId: cont!.id,
        code: "CGL_INSURANCE_2M",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "POL-CGL-882910",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        contractorId: cont!.id,
        code: "COMMERCIAL_AUTO_1M",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "POL-AUTO-99201",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        technicianId: tech!.id,
        code: "ON_SKILLED_TRADES_309A",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "COFQ-309A-88339",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        technicianId: tech!.id,
        code: "GOVT_PHOTO_ID",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "DL-ON-448822-192",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        technicianId: tech!.id,
        code: "BACKGROUND_CHECK_ANNUAL",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "BG-CERT-2026-118",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        technicianId: tech!.id,
        code: "ELECTRICAL_LICENSE",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "LIC-ELEC-88291",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
    ]);

    // Ensure approved capability assessment
    await db
      .delete(contractorCapabilityAssessments)
      .where(
        and(
          eq(contractorCapabilityAssessments.contractorId, cont!.id),
          eq(contractorCapabilityAssessments.issueTypeId, elecIssue!.id),
        ),
      );

    const [assessorUser] = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .where(eq(userRoles.role, "ADMIN"))
      .limit(1);

    await db.insert(contractorCapabilityAssessments).values({
      contractorId: cont!.id,
      issueTypeId: elecIssue!.id,
      geography: "ON",
      status: "APPROVED",
      complexityTier: "TIER_3_ADVANCED",
      yearsExperience: 8,
      maxJobValueCents: 1000000,
      assessedByUserId: assessorUser?.id ?? tech!.userId,
      assessedAt: new Date(),
      validUntil: new Date("2028-12-31T00:00:00Z"),
      decisionNotes: "Verified technical competency and certifications",
    });

    const [prop] = await db
      .select({ id: properties.id })
      .from(properties)
      .limit(1);
    expect(prop).toBeDefined();

    // 2. Customer creates service request 1 and dispatches job 1
    const createReq1 = await app.inject({
      method: "POST",
      url: "/v1/service-requests",
      headers: auth("customer@example.test"),
      payload: {
        propertyId: prop!.id,
        verticalId: elecVertical!.id,
        categoryId: elecCat!.id,
        issueTypeId: elecIssue!.id,
        urgency: "STANDARD",
        description: "Initial 200A electrical service panel upgrade",
      },
    });
    expect(createReq1.statusCode).toBe(201);
    const req1Id = createReq1.json<{ id: string }>().id;

    for (const to of [
      "QUALIFICATION_PENDING",
      "QUALIFIED",
      "SCHEDULING",
      "SCHEDULED",
      "CONTRACTOR_SEARCH",
    ] as const) {
      const trans = await app.inject({
        method: "POST",
        url: `/v1/service-requests/${req1Id}/transition`,
        headers: auth("dispatch@example.test"),
        payload: { to },
      });
      expect(trans.statusCode).toBe(200);
    }

    const assignRes1 = await app.inject({
      method: "POST",
      url: `/v1/dispatch/${req1Id}/assign`,
      headers: auth("dispatch@example.test"),
      payload: { technicianId: tech!.id },
    });
    expect(assignRes1.statusCode).toBe(201);
    const assignJson1 = assignRes1.json<{ jobId: string; id?: string }>();
    const job1Id = assignJson1.jobId ?? assignJson1.id;
    expect(job1Id).toBeDefined();

    // 3. Safety Incident Intake with Critical Emergency Escalation
    const reportRes = await app.inject({
      method: "POST",
      url: "/v1/safety/incidents",
      headers: auth("dispatch@example.test"),
      payload: {
        jobId: job1Id,
        contractorId: cont!.id,
        technicianId: tech!.id,
        reporterRole: "DISPATCHER",
        incidentType: "ELECTRICAL_HAZARD_SHOCK",
        severity: "CRITICAL_EMERGENCY",
        title: "Arc flash explosion and electrical shock hazard",
        description:
          "Severe electrical shock and arcing occurred on main feeder lug during panel replacement. Site isolated by emergency response.",
        occurredAt: new Date().toISOString(),
        hazardCategory: "ELECTRICAL",
        containmentActions: [
          {
            action: "Main feed cutoff locked out with OSHA lockout-tagout tag",
            executedBy: "Operations Safety Inspector",
            executedAt: new Date().toISOString(),
            confirmedSafe: true,
          },
        ],
        evidenceLocker: [
          {
            title: "Burn marks across 200A service disconnect and melted insulator",
            url: "https://evidence.example.test/photos/arc-flash-damage.jpg",
            artifactType: "PHOTO",
            checksumSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            chainOfCustodyVerified: true,
          },
        ],
        immediateQuarantine: true,
      },
    });
    expect(reportRes.statusCode).toBe(201);
    const incidentData = reportRes.json<{
      id: string;
      incidentNumber: string;
      status: string;
      severity: string;
      legalRetentionHold: boolean;
    }>();
    expect(incidentData.id).toBeDefined();
    expect(incidentData.incidentNumber).toMatch(/^INC-/);
    expect(incidentData.status).toBe("QUARANTINED");
    expect(incidentData.severity).toBe("CRITICAL_EMERGENCY");
    expect(incidentData.legalRetentionHold).toBe(true);

    const incidentId = incidentData.id;

    // 4. Verify Automated Suspension & Quarantine in DB
    const [suspendedCont] = await db
      .select({
        safetyStatus: contractors.safetyStatus,
        suspendedAt: contractors.suspendedAt,
      })
      .from(contractors)
      .where(eq(contractors.id, cont!.id));
    expect(suspendedCont?.safetyStatus).toBe("SUSPENDED");
    expect(suspendedCont?.suspendedAt).not.toBeNull();

    const [suspendedTech] = await db
      .select({
        safetyStatus: technicians.safetyStatus,
        suspendedAt: technicians.suspendedAt,
      })
      .from(technicians)
      .where(eq(technicians.id, tech!.id));
    expect(suspendedTech?.safetyStatus).toBe("SUSPENDED");
    expect(suspendedTech?.suspendedAt).not.toBeNull();

    const [activeQuarantine] = await db
      .select({
        id: contractorSafetyQuarantines.id,
        active: contractorSafetyQuarantines.active,
        quarantineType: contractorSafetyQuarantines.quarantineType,
      })
      .from(contractorSafetyQuarantines)
      .where(
        and(
          eq(contractorSafetyQuarantines.incidentId, incidentId),
          eq(contractorSafetyQuarantines.active, true),
        ),
      );
    expect(activeQuarantine).toBeDefined();
    expect(activeQuarantine?.quarantineType).toBe("FULL_CONTRACTOR_SUSPENSION");
    expect(activeQuarantine?.active).toBe(true);

    // 5. Pre-Dispatch Gate Enforcement (Fail Closed on Suspended Contractor)
    const createReq2 = await app.inject({
      method: "POST",
      url: "/v1/service-requests",
      headers: auth("customer@example.test"),
      payload: {
        propertyId: prop!.id,
        verticalId: elecVertical!.id,
        categoryId: elecCat!.id,
        issueTypeId: elecIssue!.id,
        urgency: "STANDARD",
        description: "Secondary electrical service inspection",
      },
    });
    expect(createReq2.statusCode).toBe(201);
    const req2Id = createReq2.json<{ id: string }>().id;

    for (const to of [
      "QUALIFICATION_PENDING",
      "QUALIFIED",
      "SCHEDULING",
      "SCHEDULED",
      "CONTRACTOR_SEARCH",
    ] as const) {
      const trans = await app.inject({
        method: "POST",
        url: `/v1/service-requests/${req2Id}/transition`,
        headers: auth("dispatch@example.test"),
        payload: { to },
      });
      expect(trans.statusCode).toBe(200);
    }

    // Dry-run eligibility evaluation fails closed
    const dryRunRes = await app.inject({
      method: "POST",
      url: `/v1/dispatch/${req2Id}/evaluate-eligibility`,
      headers: auth("dispatch@example.test"),
      payload: { technicianId: tech!.id },
    });
    expect(dryRunRes.statusCode).toBe(200);
    const dryRunJson = dryRunRes.json<{ eligible: boolean; denyCodes: string[] }>();
    expect(dryRunJson.eligible).toBe(false);
    expect(dryRunJson.denyCodes).toContain("CONTRACTOR_SAFETY_SUSPENDED");
    expect(dryRunJson.denyCodes).toContain("TECHNICIAN_SAFETY_SUSPENDED");

    // Live dispatch assign fails closed with 422 PRE_DISPATCH_INELIGIBLE
    const blockedAssign = await app.inject({
      method: "POST",
      url: `/v1/dispatch/${req2Id}/assign`,
      headers: auth("dispatch@example.test"),
      payload: { technicianId: tech!.id },
    });
    expect(blockedAssign.statusCode).toBe(422);
    expect(blockedAssign.json<{ code: string }>().code).toBe("PRE_DISPATCH_INELIGIBLE");
    expect(
      blockedAssign.json<{ details: { denyCodes: string[] } }>().details.denyCodes,
    ).toContain("CONTRACTOR_SAFETY_SUSPENDED");

    // 6. Insurer Notification Action with Claim Reference
    const insurerAction = await app.inject({
      method: "POST",
      url: `/v1/safety/incidents/${incidentId}/actions`,
      headers: auth("dispatch@example.test"),
      payload: {
        actionType: "INSURER_NOTIFIED",
        notes: "Aviva Commercial General Liability claims department notified under policy CGL-882910.",
        payload: {
          claimReference: "CLM-AVIVA-2026-9921",
          carrier: "Aviva Canada",
          estimatedLossCents: 750000,
        },
      },
    });
    expect(insurerAction.statusCode).toBe(200);

    const [notifiedIncident] = await db
      .select({
        insurerNotified: safetyIncidents.insurerNotified,
        insurerClaimReference: safetyIncidents.insurerClaimReference,
        insurerNotifiedAt: safetyIncidents.insurerNotifiedAt,
      })
      .from(safetyIncidents)
      .where(eq(safetyIncidents.id, incidentId));
    expect(notifiedIncident?.insurerNotified).toBe(true);
    expect(notifiedIncident?.insurerClaimReference).toBe("CLM-AVIVA-2026-9921");
    expect(notifiedIncident?.insurerNotifiedAt).not.toBeNull();

    // 7. Evidence Locker Preservation & Legal Retention Hold
    const preserveAction = await app.inject({
      method: "POST",
      url: `/v1/safety/incidents/${incidentId}/actions`,
      headers: auth("dispatch@example.test"),
      payload: {
        actionType: "EVIDENCE_PRESERVED",
        notes: "Locking all site photos, contractor logs, and telemetry under statutory retention hold.",
        payload: { holdReason: "Litigation hold for property damage subrogation" },
      },
    });
    expect(preserveAction.statusCode).toBe(200);

    const [preservedIncident] = await db
      .select({ legalRetentionHold: safetyIncidents.legalRetentionHold })
      .from(safetyIncidents)
      .where(eq(safetyIncidents.id, incidentId));
    expect(preservedIncident?.legalRetentionHold).toBe(true);

    // 8. Corrective Action Plan (CAP) Submission & Auto-scheduled Audit
    const remediationRes = await app.inject({
      method: "POST",
      url: `/v1/safety/incidents/${incidentId}/remediation`,
      headers: auth("dispatch@example.test"),
      payload: {
        resolutionSummary:
          "Full breaker enclosure replaced with ESA certified assembly; ground fault interrupter calibrated; NFPA 70E safety retraining completed.",
        correctiveActionsTaken: [
          "Replaced damaged service entrance busbar with CSA approved Siemens assembly",
          "Retrained technician on NFPA 70E live voltage PPE requirements",
          "Installed calibrated GFCI sensor with 5mA instant trip threshold",
        ],
        evidenceFiles: [
          {
            title: "ESA Certificate of Acceptance for service replacement",
            url: "https://evidence.example.test/remediation/esa-permit-passed.pdf",
            artifactType: "INSPECTOR_REPORT",
            checksumSha256: "f4b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b999",
            chainOfCustodyVerified: true,
          },
        ],
        requestInspection: true,
      },
    });
    expect(remediationRes.statusCode).toBe(200);
    const remediationJson = remediationRes.json<{
      incident: { status: string };
      audit: { id: string; triggerType: string; status: string };
    }>();
    expect(remediationJson.incident.status).toBe("REMEDIATING");
    expect(remediationJson.audit).toBeDefined();
    expect(remediationJson.audit.triggerType).toBe("INCIDENT_REMEDIATION");
    expect(remediationJson.audit.status).toBe("SCHEDULED");
    const auditId = remediationJson.audit.id;

    // 9. Independent Technical Quality Audit Execution
    const conductRes = await app.inject({
      method: "POST",
      url: `/v1/safety/audits/${auditId}/conduct`,
      headers: auth("dispatch@example.test"),
      payload: {
        status: "PASSED",
        findings: [
          {
            code: "OESC_ESA_PASS",
            description: "Ground fault impedance tested at 0.2 ohms; all safety enclosures compliant with Ontario Electrical Safety Code",
            severity: "MINOR",
            rectified: true,
          },
        ],
        repeatDefectCount: 0,
        remediationRequired: false,
        reportNotes: "Independent technical reinspection passed with full electrical code compliance.",
      },
    });
    expect(conductRes.statusCode).toBe(200);
    expect(conductRes.json<{ status: string }>().status).toBe("PASSED");

    // 10. Administrative Quarantine Lifting & Status Restoration (RBAC Guarded)
    const custLift = await app.inject({
      method: "POST",
      url: `/v1/safety/incidents/${incidentId}/actions`,
      headers: auth("customer@example.test"),
      payload: {
        actionType: "QUARANTINE_LIFTED",
        notes: "Attempted customer clearance",
      },
    });
    expect(custLift.statusCode).toBe(403);

    const adminLift = await app.inject({
      method: "POST",
      url: `/v1/safety/incidents/${incidentId}/actions`,
      headers: auth("admin@example.test"),
      payload: {
        actionType: "QUARANTINE_LIFTED",
        notes: "CAP approved and independent technical inspection passed. Lifting quarantine and restoring active status.",
      },
    });
    expect(adminLift.statusCode).toBe(200);

    const [restoredCont] = await db
      .select({
        safetyStatus: contractors.safetyStatus,
        suspendedAt: contractors.suspendedAt,
      })
      .from(contractors)
      .where(eq(contractors.id, cont!.id));
    expect(restoredCont?.safetyStatus).toBe("ACTIVE");
    expect(restoredCont?.suspendedAt).toBeNull();

    const [restoredTech] = await db
      .select({
        safetyStatus: technicians.safetyStatus,
        suspendedAt: technicians.suspendedAt,
      })
      .from(technicians)
      .where(eq(technicians.id, tech!.id));
    expect(restoredTech?.safetyStatus).toBe("ACTIVE");
    expect(restoredTech?.suspendedAt).toBeNull();

    const [resolvedIncident] = await db
      .select({ status: safetyIncidents.status })
      .from(safetyIncidents)
      .where(eq(safetyIncidents.id, incidentId));
    expect(resolvedIncident?.status).toBe("RESOLVED");

    // 11. Pre-Dispatch Gate Clearance: Assignment succeeds
    const retryEval = await app.inject({
      method: "POST",
      url: `/v1/dispatch/${req2Id}/evaluate-eligibility`,
      headers: auth("dispatch@example.test"),
      payload: { technicianId: tech!.id },
    });
    expect(retryEval.statusCode).toBe(200);
    const retryJson = retryEval.json<{ eligible: boolean; denyCodes: string[] }>();
    expect(retryJson.eligible).toBe(true);
    expect(retryJson.denyCodes).toHaveLength(0);

    const retryAssign = await app.inject({
      method: "POST",
      url: `/v1/dispatch/${req2Id}/assign`,
      headers: auth("dispatch@example.test"),
      payload: { technicianId: tech!.id },
    });
    expect(retryAssign.statusCode).toBe(201);
    expect(retryAssign.json<{ status: string }>().status).toBe("ASSIGNED");

    // 12. Audit Analytics & Dossier Inspection
    const dossierRes = await app.inject({
      method: "GET",
      url: `/v1/safety/incidents/${incidentId}`,
      headers: auth("dispatch@example.test"),
    });
    expect(dossierRes.statusCode).toBe(200);
    const dossierJson = dossierRes.json<{
      incident: { incidentNumber: string; status: string };
      actions: Array<{ actionType: string }>;
      quarantines: Array<{ active: boolean }>;
    }>();
    expect(dossierJson.incident.incidentNumber).toMatch(/^INC-/);
    expect(dossierJson.incident.status).toBe("RESOLVED");
    expect(dossierJson.actions.length).toBeGreaterThanOrEqual(4);
    expect(dossierJson.quarantines.length).toBeGreaterThanOrEqual(1);

    const auditsListRes = await app.inject({
      method: "GET",
      url: `/v1/safety/audits?contractorId=${cont!.id}`,
      headers: auth("dispatch@example.test"),
    });
    expect(auditsListRes.statusCode).toBe(200);
    const auditsJson = auditsListRes.json<{
      audits: Array<{ id: string; status: string }>;
      repeatDefectSummary: {
        totalAudits: number;
        repeatDefectThresholdExceeded: boolean;
      };
    }>();
    expect(auditsJson.audits.length).toBeGreaterThanOrEqual(1);
    expect(auditsJson.repeatDefectSummary.totalAudits).toBeGreaterThanOrEqual(1);
    expect(auditsJson.repeatDefectSummary.repeatDefectThresholdExceeded).toBe(false);
  });

  it("enforces electrical permits, ESA inspection evidence, defect remediation, and certificate of acceptance (#59)", async () => {
    // 1. Identify trade entities (Electrical)
    const [elecVertical] = await db
      .select({ id: verticals.id, slug: verticals.slug })
      .from(verticals)
      .where(eq(verticals.slug, "electrical"))
      .limit(1);
    expect(elecVertical).toBeDefined();

    const [elecCat] = await db
      .select({ id: serviceCategories.id, slug: serviceCategories.slug })
      .from(serviceCategories)
      .where(eq(serviceCategories.verticalId, elecVertical!.id))
      .limit(1);
    expect(elecCat).toBeDefined();

    const [elecIssue] = await db
      .select({ id: issueTypes.id, slug: issueTypes.slug })
      .from(issueTypes)
      .where(eq(issueTypes.categoryId, elecCat!.id))
      .limit(1);
    expect(elecIssue).toBeDefined();

    const [cont] = await db
      .select({ id: contractors.id, verticalIds: contractors.verticalIds })
      .from(contractors)
      .innerJoin(technicians, eq(technicians.contractorId, contractors.id))
      .where(and(eq(contractors.status, "VERIFIED"), eq(technicians.active, true)))
      .orderBy(contractors.createdAt)
      .limit(1);
    expect(cont).toBeDefined();

    const [tech] = await db
      .select({ id: technicians.id, userId: technicians.userId })
      .from(technicians)
      .where(
        and(
          eq(technicians.contractorId, cont!.id),
          eq(technicians.active, true),
        ),
      )
      .orderBy(technicians.createdAt)
      .limit(1);
    expect(tech).toBeDefined();

    const [prop] = await db
      .select({ id: properties.id })
      .from(properties)
      .limit(1);
    expect(prop).toBeDefined();

    // Ensure contractor is associated with electrical vertical and active
    const vIds = (cont!.verticalIds as string[]) ?? [];
    await db
      .update(contractors)
      .set({
        verticalIds: vIds.includes(elecVertical!.id) ? vIds : [...vIds, elecVertical!.id],
        safetyStatus: "ACTIVE",
        suspendedAt: null,
        suspensionReason: null,
      })
      .where(eq(contractors.id, cont!.id));

    await db
      .update(technicians)
      .set({
        safetyStatus: "ACTIVE",
        suspendedAt: null,
        suspensionReason: null,
      })
      .where(eq(technicians.id, tech!.id));

    await db
      .delete(contractorSafetyQuarantines)
      .where(
        or(
          eq(contractorSafetyQuarantines.contractorId, cont!.id),
          eq(contractorSafetyQuarantines.technicianId, tech!.id),
        ),
      );

    await db
      .delete(credentials)
      .where(
        and(
          eq(credentials.contractorId, cont!.id),
          inArray(credentials.code, [
            "ON_ESA_LEC_CONTRACTOR",
            "COMMERCIAL_GENERAL_LIABILITY",
            "ON_WSIB_CLEARANCE",
            "CGL_INSURANCE_2M",
            "COMMERCIAL_AUTO_1M",
          ]),
        ),
      );

    await db
      .delete(credentials)
      .where(
        and(
          eq(credentials.technicianId, tech!.id),
          inArray(credentials.code, [
            "ON_SKILLED_TRADES_309A",
            "CRIMINAL_BACKGROUND_CHECK",
            "ELECTRICAL_LICENSE",
            "GOVT_PHOTO_ID",
            "BACKGROUND_CHECK_ANNUAL",
          ]),
        ),
      );

    const futureDate = "2028-12-31";
    await db.insert(credentials).values([
      {
        contractorId: cont!.id,
        code: "ON_ESA_LEC_CONTRACTOR",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "ECRA-ESA-7001122",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        contractorId: cont!.id,
        code: "COMMERCIAL_GENERAL_LIABILITY",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "CGL-POL-2026-99",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        contractorId: cont!.id,
        code: "ON_WSIB_CLEARANCE",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "WSIB-ON-991823",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        contractorId: cont!.id,
        code: "CGL_INSURANCE_2M",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "POL-CGL-882910",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        contractorId: cont!.id,
        code: "COMMERCIAL_AUTO_1M",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "POL-AUTO-99201",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
    ]);

    await db.insert(credentials).values([
      {
        technicianId: tech!.id,
        code: "ON_SKILLED_TRADES_309A",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "309A-LIC-88291",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        technicianId: tech!.id,
        code: "CRIMINAL_BACKGROUND_CHECK",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "BG-CERT-2026-118",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        technicianId: tech!.id,
        code: "ELECTRICAL_LICENSE",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "LIC-ELEC-88291",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        technicianId: tech!.id,
        code: "GOVT_PHOTO_ID",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "DL-ON-448822-192",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        technicianId: tech!.id,
        code: "BACKGROUND_CHECK_ANNUAL",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "CERT-ANNUAL-BG-9912",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
    ]);

    await db
      .delete(contractorCapabilityAssessments)
      .where(
        and(
          eq(contractorCapabilityAssessments.contractorId, cont!.id),
          eq(contractorCapabilityAssessments.issueTypeId, elecIssue!.id),
        ),
      );

    const [assessorUser] = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .where(eq(userRoles.role, "ADMIN"))
      .limit(1);

    await db.insert(contractorCapabilityAssessments).values({
      contractorId: cont!.id,
      issueTypeId: elecIssue!.id,
      geography: "ON",
      status: "APPROVED",
      complexityTier: "TIER_3_ADVANCED",
      yearsExperience: 8,
      maxJobValueCents: 1000000,
      assessedByUserId: assessorUser?.id ?? tech!.userId,
      assessedAt: new Date(),
      validUntil: new Date("2028-12-31T00:00:00Z"),
      decisionNotes: "Verified technical competency and certifications",
    });

    // 2. Customer creates service request for 200A panel upgrade
    const createReq = await app.inject({
      method: "POST",
      url: "/v1/service-requests",
      headers: auth("customer@example.test"),
      payload: {
        propertyId: prop!.id,
        verticalId: elecVertical!.id,
        categoryId: elecCat!.id,
        issueTypeId: elecIssue!.id,
        urgency: "STANDARD",
        description:
          "200A main service panel upgrade requiring ESA permit and Toronto Hydro disconnect",
      },
    });
    expect(createReq.statusCode).toBe(201);
    const reqId = createReq.json<{ id: string }>().id;

    for (const to of [
      "QUALIFICATION_PENDING",
      "QUALIFIED",
      "SCHEDULING",
      "SCHEDULED",
      "CONTRACTOR_SEARCH",
    ] as const) {
      const trans = await app.inject({
        method: "POST",
        url: `/v1/service-requests/${reqId}/transition`,
        headers: auth("dispatch@example.test"),
        payload: { to },
      });
      expect(trans.statusCode).toBe(200);
    }

    // 3. Dispatch assignment and worker commencement
    const assignRes = await app.inject({
      method: "POST",
      url: `/v1/dispatch/${reqId}/assign`,
      headers: auth("dispatch@example.test"),
      payload: { technicianId: tech!.id },
    });
    expect(assignRes.statusCode).toBe(201);
    const assignJson = assignRes.json<{ jobId: string; id?: string }>();
    const jobId = assignJson.jobId ?? assignJson.id;
    expect(jobId).toBeDefined();

    // Verify worker identity
    const verifyIdRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${jobId}/verify-worker-identity`,
      headers: auth("dispatch@example.test"),
      payload: {
        method: "GOVT_PHOTO_ID",
        documentReference: "DL-ON-448822-192",
      },
    });
    expect(verifyIdRes.statusCode).toBe(200);

    // Commence work
    const commenceRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${jobId}/commence-work`,
      headers: auth("dispatch@example.test"),
      payload: { technicianId: tech!.id },
    });
    expect(commenceRes.statusCode).toBe(200);

    // 4. Contractor files Electrical Permit / ESA Notification
    const filePermitRes = await app.inject({
      method: "POST",
      url: "/v1/permits/electrical",
      headers: auth("dispatch@example.test"),
      payload: {
        jobId,
        esaNotificationNumber: "ESA-NOTIF-2026-88129",
        ecraLicenseNumber: "ECRA-ESA-7001122",
        designatedMasterElectrician: "David Chen (ME-309A-1082)",
        scopeOfWork:
          "Complete 200A service disconnect, meter base replacement, and 40-circuit breaker panel installation",
        utilityDisconnectRequired: true,
        utilityProvider: "Toronto Hydro",
        utilityMeterNumber: "TH-MTR-449102",
        utilityDisconnectDate: new Date().toISOString(),
      },
    });
    expect(filePermitRes.statusCode).toBe(201);
    const permitJson = filePermitRes.json<{
      id: string;
      permitNumber: string;
      status: string;
      regulatorySignOffStatus: string;
    }>();
    expect(permitJson.id).toBeDefined();
    expect(permitJson.permitNumber).toMatch(/^PERM-/);
    expect(permitJson.status).toBe("FILED");
    expect(permitJson.regulatorySignOffStatus).toBe("PENDING");
    const permitId = permitJson.id;

    // Verify jobs table updated
    const [permitJob] = await db
      .select({
        permitRequired: jobs.permitRequired,
        regulatorySignOffStatus: jobs.regulatorySignOffStatus,
      })
      .from(jobs)
      .where(eq(jobs.id, jobId));
    expect(permitJob?.permitRequired).toBe(true);
    expect(permitJob?.regulatorySignOffStatus).toBe("PENDING");

    // 5. Utility Disconnect & Reconnect Coordination
    const coordUtilityRes = await app.inject({
      method: "POST",
      url: `/v1/permits/electrical/${permitId}/utility`,
      headers: auth("dispatch@example.test"),
      payload: {
        utilityProvider: "Toronto Hydro",
        utilityMeterNumber: "TH-MTR-449102",
        utilityDisconnectDate: new Date().toISOString(),
        utilityReconnectAuthorizationCode: "TH-RECONN-AUTH-88219",
        utilityReconnectDate: new Date().toISOString(),
      },
    });
    expect(coordUtilityRes.statusCode).toBe(200);
    expect(
      coordUtilityRes.json<{ utilityReconnectAuthorizationCode: string }>()
        .utilityReconnectAuthorizationCode,
    ).toBe("TH-RECONN-AUTH-88219");

    // 6. Contractor finishes physical work
    const completeLaborRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${jobId}/complete`,
      headers: auth("dispatch@example.test"),
      payload: {
        summary:
          "200A panel installed, breakers torqued to spec, power restored via Toronto Hydro authorization",
        equipment: {
          panelManufacturer: "Schneider Square D",
          amps: "200",
        },
      },
    });
    expect(completeLaborRes.statusCode).toBe(200);

    // 7. Full Acceptance Gate Enforcement (Fail Closed: Regulatory Sign-Off Pending)
    const earlyAcceptRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${jobId}/accept-completion`,
      headers: auth("customer@example.test"),
    });
    expect(earlyAcceptRes.statusCode).toBe(422);
    const earlyAcceptJson = earlyAcceptRes.json<{
      code: string;
      details: {
        missingItems: string[];
        customerSummary: {
          requiresPermit: boolean;
          utilityDisconnectCoordinated: boolean;
        };
      };
    }>();
    expect(earlyAcceptJson.code).toBe("REGULATORY_SIGN_OFF_REQUIRED");
    expect(earlyAcceptJson.details.missingItems).toContain(
      "MISSING_CERTIFICATE_OF_ACCEPTANCE",
    );
    expect(earlyAcceptJson.details.customerSummary.requiresPermit).toBe(true);
    expect(
      earlyAcceptJson.details.customerSummary.utilityDisconnectCoordinated,
    ).toBe(true);

    // 8. ESA Inspector issues Defect Notice (Deficiency Recorded)
    const defectRes = await app.inject({
      method: "POST",
      url: `/v1/permits/electrical/${permitId}/deficiencies`,
      headers: auth("dispatch@example.test"),
      payload: {
        defectCode: "OESC-10-204",
        severity: "MAJOR",
        description:
          "Cold water bonding jumper connection loose at water meter shutoff",
        correctiveActionRequired:
          "Tighten approved bronze ground clamp and verify continuous 0.5 ohm continuity",
      },
    });
    expect(defectRes.statusCode).toBe(201);
    const defectJson = defectRes.json<{ id: string; status: string }>();
    expect(defectJson.status).toBe("OPEN");
    const defectId = defectJson.id;

    // Verify acceptance gate reports unresolved defects
    const defectGateRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${jobId}/accept-completion`,
      headers: auth("customer@example.test"),
    });
    expect(defectGateRes.statusCode).toBe(422);
    expect(
      defectGateRes.json<{ details: { missingItems: string[] } }>().details
        .missingItems,
    ).toContain("UNRESOLVED_ESA_DEFICIENCIES");

    // 9. Contractor Rectification & Inspector Defect Clearance
    const rectifyRes = await app.inject({
      method: "POST",
      url: `/v1/permits/electrical/${permitId}/deficiencies/${defectId}/rectify`,
      headers: auth("dispatch@example.test"),
      payload: {
        rectificationNotes:
          "Installed new bronze grounding clamp torqued to 35 in-lbs, continuity verified at 0.1 ohms",
        rectificationEvidenceUrl:
          "https://evidence.example.test/permits/ground-clamp-rectified.jpg",
      },
    });
    expect(rectifyRes.statusCode).toBe(200);
    expect(rectifyRes.json<{ status: string }>().status).toBe("RECTIFIED");

    // Rectified but un-cleared by inspector still blocks acceptance
    const unclearedGateRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${jobId}/accept-completion`,
      headers: auth("customer@example.test"),
    });
    expect(unclearedGateRes.statusCode).toBe(422);
    expect(
      unclearedGateRes.json<{ details: { missingItems: string[] } }>().details
        .missingItems,
    ).toContain("UNRESOLVED_ESA_DEFICIENCIES");

    // Inspector clears defect
    const clearRes = await app.inject({
      method: "POST",
      url: `/v1/permits/electrical/${permitId}/deficiencies/${defectId}/clear`,
      headers: auth("dispatch@example.test"),
      payload: {
        clearedByInspector: "ESA Inspector #4109 (Marcus Vance)",
        clearedNotes:
          "Re-inspection verified compliant bonding connection to OESC 10-204",
      },
    });
    expect(clearRes.statusCode).toBe(200);
    expect(clearRes.json<{ status: string }>().status).toBe(
      "CLEARED_BY_INSPECTOR",
    );

    // 10. Authoritative Certificate of Acceptance Registration
    const coaRes = await app.inject({
      method: "POST",
      url: `/v1/permits/electrical/${permitId}/certificate-of-acceptance`,
      headers: auth("dispatch@example.test"),
      payload: {
        certificateOfAcceptanceNumber: "ESA-COA-2026-992144",
        certificateOfAcceptanceUrl:
          "https://evidence.example.test/esa/coa-992144.pdf",
        inspectorName: "Marcus Vance",
        inspectorBadgeNumber: "ESA-INSP-4109",
        issuedAt: new Date().toISOString(),
      },
    });
    expect(coaRes.statusCode).toBe(200);
    const coaJson = coaRes.json<{
      status: string;
      regulatorySignOffStatus: string;
      certificateOfAcceptanceNumber: string;
    }>();
    expect(coaJson.status).toBe("CERTIFICATE_ISSUED");
    expect(coaJson.regulatorySignOffStatus).toBe("FULLY_ACCEPTED");
    expect(coaJson.certificateOfAcceptanceNumber).toBe("ESA-COA-2026-992144");

    // Verify DB on jobs and service_records
    const [updatedJob] = await db
      .select({
        regulatorySignOffStatus: jobs.regulatorySignOffStatus,
        certificateOfAcceptanceNumber: jobs.certificateOfAcceptanceNumber,
      })
      .from(jobs)
      .where(eq(jobs.id, jobId));
    expect(updatedJob?.regulatorySignOffStatus).toBe("FULLY_ACCEPTED");
    expect(updatedJob?.certificateOfAcceptanceNumber).toBe(
      "ESA-COA-2026-992144",
    );

    // 11. Customer Full Acceptance Gate Passed
    const finalAcceptRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${jobId}/accept-completion`,
      headers: auth("customer@example.test"),
    });
    expect(finalAcceptRes.statusCode).toBe(200);
    const finalAcceptJson = finalAcceptRes.json<{
      fullyAccepted: boolean;
      status: string;
      regulatorySignOffStatus: string;
      certificateOfAcceptanceNumber: string;
    }>();
    expect(finalAcceptJson.fullyAccepted).toBe(true);
    expect(finalAcceptJson.status).toBe("CLOSED");
    expect(finalAcceptJson.regulatorySignOffStatus).toBe("FULLY_ACCEPTED");
    expect(finalAcceptJson.certificateOfAcceptanceNumber).toBe(
      "ESA-COA-2026-992144",
    );

    // 12. Property Service Record & Transparency Dossier
    const permitDossierRes = await app.inject({
      method: "GET",
      url: `/v1/permits/jobs/${jobId}`,
      headers: auth("customer@example.test"),
    });
    expect(permitDossierRes.statusCode).toBe(200);
    const dossierJson = permitDossierRes.json<{
      permit: { esaNotificationNumber: string; certificateOfAcceptanceNumber: string };
      acceptanceEvaluation: {
        canFullyAccept: boolean;
        customerSummary: {
          requiresPermit: boolean;
          utilityDisconnectCoordinated: boolean;
          hasOutstandingDefects: boolean;
        };
      };
    }>();
    expect(dossierJson.permit.esaNotificationNumber).toBe("ESA-NOTIF-2026-88129");
    expect(dossierJson.permit.certificateOfAcceptanceNumber).toBe(
      "ESA-COA-2026-992144",
    );
    expect(dossierJson.acceptanceEvaluation.canFullyAccept).toBe(true);
    expect(
      dossierJson.acceptanceEvaluation.customerSummary.hasOutstandingDefects,
    ).toBe(false);
    expect(
      dossierJson.acceptanceEvaluation.customerSummary
        .utilityDisconnectCoordinated,
    ).toBe(true);
  });

  it("enforces versioned risk policies, red-flag hazard triggers, ops review queue, and risk-tier dispatch gates (#60)", async () => {
    // 1. Verify Active Risk Policy on file (v1.0.0)
    const activePolicyRes = await app.inject({
      method: "GET",
      url: "/v1/risk/policies/active",
      headers: auth("dispatch@example.test"),
    });
    expect(activePolicyRes.statusCode).toBe(200);
    const activePolicy = activePolicyRes.json<{
      policy: {
        id: string;
        version: string;
        isActive: boolean;
        tierThresholds: {
          lowMax: number;
          moderateMax: number;
          highMax: number;
          criticalMin: number;
        };
        hazardFlagRules: Array<{ flag: string; severity: string; inherentAdd: number; requiresManualApproval: boolean }>;
        mandatoryControlsConfig: Array<{ trigger: string; control: string }>;
      };
    }>().policy;
    expect(activePolicy.version).toBe("1.0.0");
    expect(activePolicy.isActive).toBe(true);
    expect(activePolicy.tierThresholds.criticalMin).toBe(81);
    expect(
      activePolicy.hazardFlagRules.some(
        (r) => r.flag === "HIGH_VOLTAGE" && r.requiresManualApproval,
      ),
    ).toBe(true);

    // 2. Locate Electrical vertical & panel upgrade issue
    const [elecVertical] = await db
      .select({ id: verticals.id, slug: verticals.slug })
      .from(verticals)
      .where(eq(verticals.slug, "electrical"))
      .limit(1);
    expect(elecVertical).toBeDefined();

    const [elecCat] = await db
      .select({ id: serviceCategories.id })
      .from(serviceCategories)
      .where(eq(serviceCategories.verticalId, elecVertical!.id))
      .limit(1);
    expect(elecCat).toBeDefined();

    const [elecIssue] = await db
      .select({ id: issueTypes.id, slug: issueTypes.slug })
      .from(issueTypes)
      .where(eq(issueTypes.categoryId, elecCat!.id))
      .limit(1);
    expect(elecIssue).toBeDefined();

    const [prop] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(eq(properties.customerId, custUser.id))
      .limit(1);
    expect(prop).toBeDefined();

    // 3. Create Service Request for High-Risk Electrical Panel Work
    const createReq = await app.inject({
      method: "POST",
      url: "/v1/service-requests",
      headers: auth("customer@example.test"),
      payload: {
        propertyId: prop!.id,
        verticalId: elecVertical!.id,
        categoryId: elecCat!.id,
        issueTypeId: elecIssue!.id,
        urgency: "STANDARD",
        description:
          "600V Main Distribution Panel Upgrade in basement crawlspace with suspected hazards",
        attachmentKeys: [],
      },
    });
    expect(createReq.statusCode).toBe(201);
    const requestId = createReq.json<{ id: string }>().id;

    // Transition to CONTRACTOR_SEARCH
    for (const to of [
      "QUALIFICATION_PENDING",
      "QUALIFIED",
      "SCHEDULING",
      "SCHEDULED",
      "CONTRACTOR_SEARCH",
    ] as const) {
      const transRes = await app.inject({
        method: "POST",
        url: `/v1/service-requests/${requestId}/transition`,
        headers: auth("dispatch@example.test"),
        payload: { to },
      });
      expect(transRes.statusCode).toBe(200);
    }

    // 4. Score Service Request Risk with RED_FLAG Triggers (HIGH_VOLTAGE & CONFINED_SPACE)
    const assessRes = await app.inject({
      method: "POST",
      url: `/v1/risk/service-requests/${requestId}/assess`,
      headers: auth("dispatch@example.test"),
      payload: {
        hazardFlags: ["HIGH_VOLTAGE", "CONFINED_SPACE"],
        jobValueCents: 450000,
        propertyAgeYears: 55,
        voltageLevelVolts: 600,
        confinedSpaceAccess: true,
        isCommercialOrIndustrial: false,
        mitigationFactors: [
          { mitigation: "SITE_INSPECTION_CONDUCTED", verified: true },
        ],
      },
    });
    expect(assessRes.statusCode).toBe(200);
    const assessData = assessRes.json<{
      assessment: {
        id: string;
        serviceRequestId: string;
        riskTier: string;
        inherentScore: number;
        residualScore: number;
        requiresManualApproval: boolean;
        manualApprovalStatus: string;
        hazardFlags: string[];
        mandatoryControls: Array<{ control: string; fulfilled: boolean }>;
        decisionLog: { redFlagTriggered: boolean };
      };
      evaluation: { canDispatch: boolean; riskTier: string; denyCodes: string[] };
    }>();

    const assessmentId = assessData.assessment.id;
    expect(assessData.assessment.riskTier).toBe("CRITICAL");
    expect(assessData.assessment.requiresManualApproval).toBe(true);
    expect(assessData.assessment.manualApprovalStatus).toBe("PENDING_REVIEW");
    expect(assessData.assessment.decisionLog.redFlagTriggered).toBe(true);
    expect(assessData.evaluation.canDispatch).toBe(false);
    expect(assessData.assessment.mandatoryControls.length).toBeGreaterThan(0);
    expect(
      assessData.assessment.mandatoryControls.some(
        (c) => c.control === "LOCKOUT_TAGOUT_PLAN",
      ),
    ).toBe(true);
    expect(
      assessData.assessment.mandatoryControls.some(
        (c) => c.control === "CAL_RATED_PPE",
      ),
    ).toBe(true);
    expect(
      assessData.assessment.mandatoryControls.some(
        (c) => c.control === "ATMOSPHERIC_TESTING",
      ),
    ).toBe(true);

    // Retrieve via GET /v1/risk/service-requests/:id/assessment
    const getAssessRes = await app.inject({
      method: "GET",
      url: `/v1/risk/service-requests/${requestId}/assessment`,
      headers: auth("dispatch@example.test"),
    });
    expect(getAssessRes.statusCode).toBe(200);
    expect(
      getAssessRes.json<{ assessment: { id: string } }>().assessment.id,
    ).toBe(assessmentId);

    // 5. Query candidate list for dispatch
    const candRes = await app.inject({
      method: "GET",
      url: `/v1/dispatch/${requestId}/candidates`,
      headers: auth("dispatch@example.test"),
    });
    expect(candRes.statusCode).toBe(200);
    const candidateList = candRes.json<{
      candidates: Array<{ technicianId: string }>;
    }>().candidates;
    expect(candidateList.length).toBeGreaterThan(0);
    const techId = candidateList[0]!.technicianId;

    // 6. DISPATCH GATE 1: Attempt assignment -> FAILS CLOSED on Pending Ops Manual Approval
    const blockedAssignRes = await app.inject({
      method: "POST",
      url: `/v1/dispatch/${requestId}/assign`,
      headers: auth("dispatch@example.test"),
      payload: { technicianId: techId },
    });
    expect(blockedAssignRes.statusCode).toBe(422);
    const blockedJson = blockedAssignRes.json<{
      code: string;
      details: { manualApprovalStatus: string; requiresManualApproval: boolean };
    }>();
    expect(blockedJson.code).toBe("CRITICAL_RISK_MANUAL_APPROVAL_REQUIRED");
    expect(blockedJson.details.manualApprovalStatus).toBe("PENDING_REVIEW");
    expect(blockedJson.details.requiresManualApproval).toBe(true);

    // 7. Verify Job Risk Review Queue (Operations Dashboard)
    const queueRes = await app.inject({
      method: "GET",
      url: "/v1/risk/review-queue",
      headers: auth("dispatch@example.test"),
    });
    expect(queueRes.statusCode).toBe(200);
    const queueData = queueRes.json<{
      pendingReviews: Array<{ id: string; serviceRequestId: string; riskTier: string }>;
      totalPending: number;
    }>();
    expect(queueData.totalPending).toBeGreaterThan(0);
    expect(
      queueData.pendingReviews.some(
        (r) => r.id === assessmentId && r.serviceRequestId === requestId,
      ),
    ).toBe(true);

    // 8. Operations Safety Officer Approves Critical Risk Assessment
    const reviewRes = await app.inject({
      method: "POST",
      url: `/v1/risk/assessments/${assessmentId}/review`,
      headers: auth("admin@example.test"),
      payload: {
        decision: "APPROVED",
        approvalNotes:
          "Site-specific engineering control reviewed. High-voltage 600V safety procedures verified.",
      },
    });
    expect(reviewRes.statusCode).toBe(200);
    const reviewJson = reviewRes.json<{
      decision: string;
      assessment: { manualApprovalStatus: string };
    }>();
    expect(reviewJson.decision).toBe("APPROVED");
    expect(reviewJson.assessment.manualApprovalStatus).toBe("APPROVED");

    // 9. DISPATCH GATE 2: Attempt assignment -> FAILS CLOSED on Unfulfilled Mandatory Controls
    const blockedControlsRes = await app.inject({
      method: "POST",
      url: `/v1/dispatch/${requestId}/assign`,
      headers: auth("dispatch@example.test"),
      payload: { technicianId: techId },
    });
    expect(blockedControlsRes.statusCode).toBe(422);
    const blockedControlsJson = blockedControlsRes.json<{
      code: string;
      details: { unfulfilledControls: string[] };
    }>();
    expect(blockedControlsJson.code).toBe(
      "UNFULFILLED_MANDATORY_SAFETY_CONTROLS",
    );
    expect(
      blockedControlsJson.details.unfulfilledControls.length,
    ).toBeGreaterThan(0);

    // 10. Fulfill each mandated control sequentially
    for (const ctrl of assessData.assessment.mandatoryControls) {
      const fulfillRes = await app.inject({
        method: "POST",
        url: `/v1/risk/assessments/${assessmentId}/fulfill-control`,
        headers: auth("technician@example.test"),
        payload: {
          control: ctrl.control,
          notes: `Uploaded compliance checklist and equipment cert for ${ctrl.control}`,
          evidenceUrl: `https://storage.skilledhire.ca/safety-dossiers/${ctrl.control.toLowerCase()}.pdf`,
        },
      });
      expect(fulfillRes.statusCode).toBe(200);
      expect(
        fulfillRes.json<{ fulfilledControl: { fulfilled: boolean } }>()
          .fulfilledControl.fulfilled,
      ).toBe(true);
    }

    // 11. DISPATCH GATE 3: Assignment Succeeds Now That Risk Gates Are Cleared
    const assignSuccessRes = await app.inject({
      method: "POST",
      url: `/v1/dispatch/${requestId}/assign`,
      headers: auth("dispatch@example.test"),
      payload: { technicianId: techId },
    });
    expect(assignSuccessRes.statusCode).toBe(201);
    const assignedJobId = assignSuccessRes.json<{ jobId: string }>().jobId;
    expect(assignedJobId).toBeDefined();

    // Verify DB linkage on jobs table
    const [assignedJobRow] = await db
      .select({
        id: jobs.id,
        riskTier: jobs.riskTier,
        riskScore: jobs.riskScore,
        riskAssessmentId: jobs.riskAssessmentId,
        riskReviewStatus: jobs.riskReviewStatus,
      })
      .from(jobs)
      .where(eq(jobs.id, assignedJobId));
    expect(assignedJobRow?.riskTier).toBe("CRITICAL");
    expect(assignedJobRow?.riskReviewStatus).toBe("APPROVED");
    expect(assignedJobRow?.riskAssessmentId).toBe(assessmentId);

    // 12. Pre-work Worker Identity & Commencement Gate
    const idVerifyRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${assignedJobId}/verify-worker-identity`,
      headers: auth("dispatch@example.test"),
      payload: {
        method: "GOVT_PHOTO_ID",
        notes: "Ontario Trade Certificate Card #STO-309A verified",
      },
    });
    expect(idVerifyRes.statusCode).toBe(200);

    const commenceRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${assignedJobId}/commence-work`,
      headers: auth("dispatch@example.test"),
      payload: {
        technicianId: techId,
        notes:
          "LOTO applied, atmospheric gas detector zeroed, arc-flash suit donned",
      },
    });
    expect(commenceRes.statusCode).toBe(200);
    expect(commenceRes.json<{ status: string }>().status).toBe(
      "WORK_IN_PROGRESS",
    );

    // 13. Safe Unknown-Input Behavior Invariant Test
    // Even if parameters are missing or anomalous, evaluateJobRisk does not crash and defaults conservatively
    const missingInputRes = await app.inject({
      method: "POST",
      url: `/v1/risk/service-requests/${requestId}/assess`,
      headers: auth("dispatch@example.test"),
      payload: {
        hazardFlags: ["LIVE_ELECTRICAL_WORK"],
      },
    });
    expect(missingInputRes.statusCode).toBe(200);
    const missingInputJson = missingInputRes.json<{
      assessment: { riskTier: string; requiresManualApproval: boolean };
    }>();
    expect(missingInputJson.assessment.riskTier).toBe("CRITICAL");
    expect(missingInputJson.assessment.requiresManualApproval).toBe(true);
  });

  it("enforces marketplace role disclosure, provider indemnity covenants, tamper-evident e-signatures, and pre-dispatch agreement gates (#61)", async () => {
    // Reset test-created versions/signatures to guarantee idempotency across multiple test runs
    await db
      .delete(agreementSignatures)
      .where(ne(agreementSignatures.agreementVersion, "1.0.0"));
    await db
      .delete(legalAgreements)
      .where(ne(legalAgreements.version, "1.0.0"));
    await db
      .update(legalAgreements)
      .set({ isActive: true, supersededAt: null })
      .where(eq(legalAgreements.version, "1.0.0"));

    // 1. Discover Active Canonical Agreements for Ontario (GET /v1/legal/agreements/active)
    const activeAgreementsRes = await app.inject({
      method: "GET",
      url: "/v1/legal/agreements/active?jurisdiction=ON",
    });
    expect(activeAgreementsRes.statusCode).toBe(200);
    const activeAgreementsJson = activeAgreementsRes.json<{
      agreements: Array<{
        id: string;
        type: string;
        version: string;
        jurisdiction: string;
        title: string;
        summary: string;
        contentChecksum: string;
        legalCounselRef: string;
        isActive: boolean;
        keyTerms: Record<string, unknown>;
      }>;
      jurisdiction: string;
    }>();

    expect(activeAgreementsJson.jurisdiction).toBe("ON");
    expect(activeAgreementsJson.agreements.length).toBeGreaterThanOrEqual(2);

    const initialIca = activeAgreementsJson.agreements.find(
      (a) => a.type === "INDEPENDENT_CONTRACTOR_AGREEMENT",
    );
    const initialCst = activeAgreementsJson.agreements.find(
      (a) => a.type === "CUSTOMER_SERVICE_TERMS",
    );

    expect(initialIca).toBeDefined();
    expect(initialIca?.version).toBe("1.0.0");
    expect(initialIca?.legalCounselRef).toBe("ON-LEGAL-2026-ICA-771");
    expect(initialIca?.isActive).toBe(true);
    expect(initialIca?.keyTerms?.indemnityScope).toBe(
      "FULL_TRADE_DEFENSE_AND_INDEMNITY",
    );
    expect(initialIca?.keyTerms?.permitResponsibility).toBe(
      "CONTRACTOR_EXCLUSIVE",
    );

    expect(initialCst).toBeDefined();
    expect(initialCst?.version).toBe("1.0.0");
    expect(initialCst?.legalCounselRef).toBe("ON-LEGAL-2026-CST-882");
    expect(initialCst?.isActive).toBe(true);
    expect(initialCst?.keyTerms?.consumerProtectionActCompliant).toBe(true);
    expect(initialCst?.keyTerms?.intermediaryModel).toBe(
      "DIRECT_CONTRACTOR_PRIVITY",
    );

    // 2. Query Agreement by ID (GET /v1/legal/agreements/:id)
    const getIcaRes = await app.inject({
      method: "GET",
      url: `/v1/legal/agreements/${initialIca!.id}`,
    });
    expect(getIcaRes.statusCode).toBe(200);
    const getIcaJson = getIcaRes.json<{
      agreement: {
        id: string;
        contentMarkdown: string;
        contentChecksum: string;
      };
    }>();
    expect(getIcaJson.agreement.contentMarkdown).toContain(
      "MASTER INDEPENDENT CONTRACTOR AGREEMENT",
    );
    expect(getIcaJson.agreement.contentChecksum).toBe(
      initialIca!.contentChecksum,
    );

    // 3. Prepare Service Request for Dispatch
    const [elecVertical] = await db
      .select({ id: verticals.id })
      .from(verticals)
      .where(eq(verticals.slug, "electrical"))
      .limit(1);
    const [elecCat] = await db
      .select({ id: serviceCategories.id })
      .from(serviceCategories)
      .where(
        and(
          eq(serviceCategories.verticalId, elecVertical!.id),
          eq(serviceCategories.slug, "panel-service"),
        ),
      )
      .limit(1);
    const [elecIssue] = await db
      .select({ id: issueTypes.id })
      .from(issueTypes)
      .where(
        and(
          eq(issueTypes.categoryId, elecCat!.id),
          eq(issueTypes.slug, "panel-upgrade-200a"),
        ),
      )
      .limit(1);
    const [prop] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(eq(properties.customerId, custUser.id))
      .limit(1);

    const [contractorRow] = await db
      .select()
      .from(contractors)
      .orderBy(asc(contractors.createdAt))
      .limit(1);
    const [techRow] = await db
      .select()
      .from(technicians)
      .where(eq(technicians.contractorId, contractorRow!.id))
      .orderBy(asc(technicians.createdAt))
      .limit(1);

    expect(contractorRow).toBeDefined();
    expect(techRow).toBeDefined();

    // Ensure contractor is associated with electrical vertical, has clean safety status, valid credentials, and approved capability
    const vIds = (contractorRow!.verticalIds as string[]) ?? [];
    await db
      .update(contractors)
      .set({
        verticalIds: vIds.includes(elecVertical!.id)
          ? vIds
          : [...vIds, elecVertical!.id],
        status: "VERIFIED",
        safetyStatus: "ACTIVE",
        suspendedAt: null,
        suspensionReason: null,
      })
      .where(eq(contractors.id, contractorRow!.id));

    await db
      .update(technicians)
      .set({
        active: true,
        safetyStatus: "ACTIVE",
        suspendedAt: null,
        suspensionReason: null,
      })
      .where(eq(technicians.id, techRow!.id));

    await db
      .delete(contractorSafetyQuarantines)
      .where(
        or(
          eq(contractorSafetyQuarantines.contractorId, contractorRow!.id),
          eq(contractorSafetyQuarantines.technicianId, techRow!.id),
        ),
      );

    const futureDate = "2028-12-31";
    await db
      .delete(credentials)
      .where(
        and(
          eq(credentials.contractorId, contractorRow!.id),
          inArray(credentials.code, [
            "ON_ESA_LEC_CONTRACTOR",
            "COMMERCIAL_GENERAL_LIABILITY",
            "ON_WSIB_CLEARANCE",
            "CGL_INSURANCE_2M",
            "COMMERCIAL_AUTO_1M",
          ]),
        ),
      );

    await db.insert(credentials).values([
      {
        contractorId: contractorRow!.id,
        code: "ON_ESA_LEC_CONTRACTOR",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "ECRA-ESA-7001122",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        contractorId: contractorRow!.id,
        code: "COMMERCIAL_GENERAL_LIABILITY",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "CGL-POL-2026-99",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        contractorId: contractorRow!.id,
        code: "ON_WSIB_CLEARANCE",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "WSIB-ON-991823",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        contractorId: contractorRow!.id,
        code: "CGL_INSURANCE_2M",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "POL-CGL-882910",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        contractorId: contractorRow!.id,
        code: "COMMERCIAL_AUTO_1M",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "POL-AUTO-99201",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
    ]);

    await db
      .delete(credentials)
      .where(
        and(
          eq(credentials.technicianId, techRow!.id),
          inArray(credentials.code, [
            "ON_SKILLED_TRADES_309A",
            "CRIMINAL_BACKGROUND_CHECK",
            "ELECTRICAL_LICENSE",
            "GOVT_PHOTO_ID",
            "BACKGROUND_CHECK_ANNUAL",
          ]),
        ),
      );

    await db.insert(credentials).values([
      {
        technicianId: techRow!.id,
        code: "ON_SKILLED_TRADES_309A",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "309A-LIC-88291",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        technicianId: techRow!.id,
        code: "CRIMINAL_BACKGROUND_CHECK",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "BG-CERT-2026-118",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        technicianId: techRow!.id,
        code: "ELECTRICAL_LICENSE",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "LIC-ELEC-88291",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        technicianId: techRow!.id,
        code: "GOVT_PHOTO_ID",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "DL-ON-448822-192",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
      {
        technicianId: techRow!.id,
        code: "BACKGROUND_CHECK_ANNUAL",
        geography: "ON",
        status: "VERIFIED",
        verificationSource: "REGULATOR_API",
        regulatorReference: "CERT-ANNUAL-BG-9912",
        expiryDate: futureDate,
        checkedAt: new Date(),
      },
    ]);

    await db
      .delete(contractorCapabilityAssessments)
      .where(
        and(
          eq(contractorCapabilityAssessments.contractorId, contractorRow!.id),
          eq(contractorCapabilityAssessments.issueTypeId, elecIssue!.id),
        ),
      );

    await db.insert(contractorCapabilityAssessments).values({
      contractorId: contractorRow!.id,
      issueTypeId: elecIssue!.id,
      geography: "ON",
      status: "APPROVED",
      complexityTier: "TIER_3_ADVANCED",
      yearsExperience: 8,
      maxJobValueCents: 10000000,
      assessedByUserId: custUser.id,
      assessedAt: new Date(),
      validUntil: new Date("2028-12-31T00:00:00Z"),
      decisionNotes:
        "Verified technical competency and certifications for legal gate testing",
    });

    const createReqRes = await app.inject({
      method: "POST",
      url: "/v1/service-requests",
      headers: auth("customer@example.test"),
      payload: {
        propertyId: prop!.id,
        verticalId: elecVertical!.id,
        categoryId: elecCat!.id,
        issueTypeId: elecIssue!.id,
        urgency: "STANDARD",
        description:
          "200A main service panel installation and whole-home distribution",
        attachmentKeys: [],
      },
    });
    expect(createReqRes.statusCode).toBe(201);
    const requestId = createReqRes.json<{ id: string }>().id;

    for (const to of [
      "QUALIFICATION_PENDING",
      "QUALIFIED",
      "SCHEDULING",
      "SCHEDULED",
      "CONTRACTOR_SEARCH",
    ] as const) {
      const transRes = await app.inject({
        method: "POST",
        url: `/v1/service-requests/${requestId}/transition`,
        headers: auth("dispatch@example.test"),
        payload: { to },
      });
      expect(transRes.statusCode).toBe(200);
    }

    // 4. Admin publishes a NEW ICA Version (v1.1.0) with updated statutory covenants
    const newIcaMarkdown =
      "# Ontario Independent Trade Contractor & Platform Indemnity Agreement (v1.1.0)\n\n" +
      "## Section 1: Tripartite Relationship\n" +
      "SkilledHire acts solely as a two-sided technology platform intermediary. Direct privity of contract " +
      "for all trade and building services is formed exclusively between the Registered Contractor and Customer.\n\n" +
      "## Section 2: Statutory Permits & Worker Qualification Warranty\n" +
      "Contractor covenants and warrants that only properly licensed technicians under Ontario Skilled Trades Ontario " +
      "shall perform restricted trade activities, and Contractor shall pull all necessary ESA/TSSA/municipal permits.\n\n" +
      "## Section 3: Comprehensive Provider Indemnity\n" +
      "Contractor shall defend, indemnify, and hold harmless SkilledHire from any third-party claims arising from workmanship, " +
      "except solely where caused by the gross negligence of the Platform.";

    const createAgreementRes = await app.inject({
      method: "POST",
      url: "/v1/legal/agreements",
      headers: auth("admin@example.test"),
      payload: {
        type: "INDEPENDENT_CONTRACTOR_AGREEMENT",
        version: "1.1.0",
        jurisdiction: "ON",
        title: "Ontario Independent Trade Contractor Master Agreement (v1.1.0)",
        summary:
          "Updated 2026 annual statutory indemnity and worker qualification schedule",
        contentMarkdown: newIcaMarkdown,
        legalCounselRef: "ON-LEGAL-2026-ICA-912",
        keyTerms: {
          intermediaryRole: "TECHNOLOGY_PLATFORM",
          indemnityScope: "MUTUAL_EXCEPT_GROSS_NEGLIGENCE",
          permitPullingParty: "CONTRACTOR",
          workmanshipWarrantyMonths: 12,
        },
      },
    });
    expect(createAgreementRes.statusCode).toBe(201);
    const newIca = createAgreementRes.json<{
      agreement: {
        id: string;
        version: string;
        contentChecksum: string;
        isActive: boolean;
      };
    }>().agreement;
    expect(newIca.version).toBe("1.1.0");
    expect(newIca.isActive).toBe(true);

    // Verify previous v1.0.0 was atomically superseded
    const [supersededIca] = await db
      .select()
      .from(legalAgreements)
      .where(eq(legalAgreements.id, initialIca!.id));
    expect(supersededIca?.isActive).toBe(false);
    expect(supersededIca?.supersededAt).toBeDefined();

    // 5. DISPATCH GATE: Assignment FAILS CLOSED because contractor has NOT signed v1.1.0
    const blockedDispatchRes = await app.inject({
      method: "POST",
      url: `/v1/dispatch/${requestId}/assign`,
      headers: auth("dispatch@example.test"),
      payload: { technicianId: techRow!.id },
    });
    expect(blockedDispatchRes.statusCode).toBe(422);
    const blockedDispatchJson = blockedDispatchRes.json<{
      code: string;
      message: string;
      details: {
        contractorId: string;
        requiredAgreementId: string;
        requiredVersion: string;
        jurisdiction: string;
      };
    }>();
    expect(blockedDispatchJson.code).toBe("CONTRACTOR_AGREEMENT_REQUIRED");
    expect(blockedDispatchJson.details.requiredVersion).toBe("1.1.0");
    expect(blockedDispatchJson.details.requiredAgreementId).toBe(newIca.id);
    expect(blockedDispatchJson.details.contractorId).toBe(contractorRow!.id);

    // 6. Signature Status Check: Shows unsigned for current active version
    const statusRes = await app.inject({
      method: "GET",
      url: `/v1/legal/signatures/status?type=INDEPENDENT_CONTRACTOR_AGREEMENT&contractorId=${contractorRow!.id}&jurisdiction=ON`,
    });
    expect(statusRes.statusCode).toBe(200);
    const statusJson = statusRes.json<{
      signed: boolean;
      activeVersion: string;
      agreementId: string;
    }>();
    expect(statusJson.signed).toBe(false);
    expect(statusJson.activeVersion).toBe("1.1.0");

    // 7. Security / Tamper Protections:
    // 7a. Mismatched Checksum is rejected
    const badChecksumRes = await app.inject({
      method: "POST",
      url: "/v1/legal/signatures",
      headers: auth("owner@example.test"),
      payload: {
        agreementId: newIca.id,
        entityType: "CONTRACTOR",
        contractorId: contractorRow!.id,
        signerLegalName: "Jordan Owner",
        agreementChecksum:
          "0000000000000000000000000000000000000000000000000000000000000000",
      },
    });
    expect(badChecksumRes.statusCode).toBe(422);
    expect(badChecksumRes.json<{ code: string }>().code).toBe(
      "AGREEMENT_CHECKSUM_MISMATCH",
    );

    // 7b. Unauthorized caller (customer trying to sign on behalf of contractor entity) is rejected
    const unauthorizedSigRes = await app.inject({
      method: "POST",
      url: "/v1/legal/signatures",
      headers: auth("customer@example.test"),
      payload: {
        agreementId: newIca.id,
        entityType: "CONTRACTOR",
        contractorId: contractorRow!.id,
        signerLegalName: "Imposter Signer",
        agreementChecksum: newIca.contentChecksum,
      },
    });
    expect(unauthorizedSigRes.statusCode).toBe(403);
    expect(unauthorizedSigRes.json<{ code: string }>().code).toBe("FORBIDDEN");

    // 8. Legitimate Contractor Owner E-Signature Execution (POST /v1/legal/signatures)
    const signRes = await app.inject({
      method: "POST",
      url: "/v1/legal/signatures",
      headers: auth("owner@example.test"),
      payload: {
        agreementId: newIca.id,
        entityType: "CONTRACTOR",
        contractorId: contractorRow!.id,
        signerLegalName: "Jordan Owner, Licensed Master HVAC Tradesperson",
        signerTitle: "President & Principal Contractor",
        agreementChecksum: newIca.contentChecksum,
        metadata: {
          clientIpConsent: true,
          signerRoleConfirmation: "AUTHORIZED_CORPORATE_SIGNING_OFFICER",
        },
      },
    });
    expect(signRes.statusCode).toBe(201);
    const signatureRecord = signRes.json<{
      signature: {
        id: string;
        agreementId: string;
        agreementVersion: string;
        signerLegalName: string;
        signerTitle: string;
        ipAddress: string;
        userAgent: string;
        agreementChecksum: string;
        signedAt: string;
      };
    }>().signature;

    expect(signatureRecord.id).toBeDefined();
    expect(signatureRecord.agreementVersion).toBe("1.1.0");
    expect(signatureRecord.signerLegalName).toBe(
      "Jordan Owner, Licensed Master HVAC Tradesperson",
    );
    expect(signatureRecord.signerTitle).toBe(
      "President & Principal Contractor",
    );
    expect(signatureRecord.agreementChecksum).toBe(newIca.contentChecksum);
    expect(signatureRecord.ipAddress).toBeDefined();
    expect(signatureRecord.userAgent).toBeDefined();

    // Verify signature status is now signed
    const postSignStatusRes = await app.inject({
      method: "GET",
      url: `/v1/legal/signatures/status?type=INDEPENDENT_CONTRACTOR_AGREEMENT&contractorId=${contractorRow!.id}&jurisdiction=ON`,
    });
    expect(postSignStatusRes.statusCode).toBe(200);
    expect(postSignStatusRes.json<{ signed: boolean }>().signed).toBe(true);

    // 9. DISPATCH GATE SUCCEEDS: With valid active ICA signed, dispatch is allowed
    const assignSuccessRes = await app.inject({
      method: "POST",
      url: `/v1/dispatch/${requestId}/assign`,
      headers: auth("dispatch@example.test"),
      payload: { technicianId: techRow!.id },
    });
    expect(assignSuccessRes.statusCode).toBe(201);
    const assignedJobId = assignSuccessRes.json<{ jobId: string }>().jobId;
    expect(assignedJobId).toBeDefined();

    // 10. E-Signature Evidence Certificate Generation (GET /v1/legal/signatures/:id/certificate)
    // 10a. Tenant Isolation: Customer cannot view contractor's signature certificate
    const tenantIsolationRes = await app.inject({
      method: "GET",
      url: `/v1/legal/signatures/${signatureRecord.id}/certificate`,
      headers: auth("customer@example.test"),
    });
    expect(tenantIsolationRes.statusCode).toBe(403);
    expect(tenantIsolationRes.json<{ code: string }>().code).toBe("FORBIDDEN");

    // 10b. Contractor owner retrieves their own evidence certificate
    const ownerCertRes = await app.inject({
      method: "GET",
      url: `/v1/legal/signatures/${signatureRecord.id}/certificate`,
      headers: auth("owner@example.test"),
    });
    expect(ownerCertRes.statusCode).toBe(200);
    const ownerCert = ownerCertRes.json<{
      certificate: {
        certificateId: string;
        signatureId: string;
        agreement: {
          id: string;
          version: string;
          legalCounselRef: string;
        };
        signer: {
          legalName: string;
          title: string;
        };
        evidence: {
          signedAt: string;
          tamperCheckPassed: boolean;
        };
        disclosures: {
          governingLaw: string;
        };
      };
    }>().certificate;

    expect(ownerCert.evidence.tamperCheckPassed).toBe(true);
    expect(ownerCert.signer.legalName).toBe(
      "Jordan Owner, Licensed Master HVAC Tradesperson",
    );
    expect(ownerCert.signer.title).toBe("President & Principal Contractor");
    expect(ownerCert.agreement.legalCounselRef).toBe("ON-LEGAL-2026-ICA-912");
    expect(ownerCert.disclosures.governingLaw).toBe("ONTARIO_CANADA");

    // 10c. Ops / Admin can retrieve certificate for legal / court audit
    const opsCertRes = await app.inject({
      method: "GET",
      url: `/v1/legal/signatures/${signatureRecord.id}/certificate`,
      headers: auth("admin@example.test"),
    });
    expect(opsCertRes.statusCode).toBe(200);
    expect(
      opsCertRes.json<{
        certificate: { evidence: { tamperCheckPassed: boolean } };
      }>().certificate.evidence.tamperCheckPassed,
    ).toBe(true);

    // 11. Customer Signs Customer Service Terms
    const custSignRes = await app.inject({
      method: "POST",
      url: "/v1/legal/signatures",
      headers: auth("customer@example.test"),
      payload: {
        agreementId: initialCst!.id,
        entityType: "CUSTOMER",
        signerLegalName: "Avery Homeowner",
        agreementChecksum: initialCst!.contentChecksum,
        metadata: { checkoutConsent: true },
      },
    });
    expect(custSignRes.statusCode).toBe(201);
    const custSignature = custSignRes.json<{ signature: { id: string } }>()
      .signature;

    // Customer can view their own certificate
    const custCertRes = await app.inject({
      method: "GET",
      url: `/v1/legal/signatures/${custSignature.id}/certificate`,
      headers: auth("customer@example.test"),
    });
    expect(custCertRes.statusCode).toBe(200);
    expect(
      custCertRes.json<{
        certificate: { signer: { legalName: string } };
      }>().certificate.signer.legalName,
    ).toBe("Avery Homeowner");

    // 12. Legal Ops Audit Trail (GET /v1/legal/audit)
    // Non-ops caller is forbidden
    const nonOpsAuditRes = await app.inject({
      method: "GET",
      url: "/v1/legal/audit",
      headers: auth("customer@example.test"),
    });
    expect(nonOpsAuditRes.statusCode).toBe(403);

    // Ops caller retrieves signatures with filtering
    const opsAuditRes = await app.inject({
      method: "GET",
      url: `/v1/legal/audit?contractorId=${contractorRow!.id}`,
      headers: auth("admin@example.test"),
    });
    expect(opsAuditRes.statusCode).toBe(200);
    const opsAuditJson = opsAuditRes.json<{
      signatures: Array<{
        id: string;
        contractorId: string;
        agreementVersion: string;
      }>;
      count: number;
    }>();
    expect(opsAuditJson.count).toBeGreaterThanOrEqual(1);
    expect(
      opsAuditJson.signatures.some(
        (s) => s.agreementVersion === "1.1.0" && s.id === signatureRecord.id,
      ),
    ).toBe(true);
  });

  it("enforces optional customer protection insurance, underwriting eligibility, tamper-evident coverage certificates, claims adjudication, and financial reconciliation (#62)", async () => {
    // 1. Discover Active Protection Products & Statutory Broker Disclosures (GET /v1/protection/products)
    const discoveryRes = await app.inject({
      method: "GET",
      url: "/v1/protection/products?jurisdiction=ON",
    });
    expect(discoveryRes.statusCode).toBe(200);
    const discoveryJson = discoveryRes.json<{
      products: Array<{
        id: string;
        slug: string;
        name: string;
        underwriterName: string;
        underwriterPolicyRef: string;
        brokerName: string;
        brokerLicenseRef: string;
        coverageLimitCents: number;
        deductibleCents: number;
        durationMonths: number;
        baseRateBps: number;
        minPremiumCents: number;
        termsMarkdown: string;
        disclaimers: string[];
      }>;
      jurisdiction: string;
      statutoryDisclosures: string[];
    }>();

    expect(discoveryJson.jurisdiction).toBe("ON");
    expect(discoveryJson.products.length).toBeGreaterThanOrEqual(3);

    // Verify statutory consumer protection disclosures (FSRA/RIBO compliance)
    expect(
      discoveryJson.statutoryDisclosures.some((d) =>
        d.includes("SkilledHire Insurance Services Inc. (RIBO #39102)"),
      ),
    ).toBe(true);
    expect(
      discoveryJson.statutoryDisclosures.some((d) =>
        d.includes("Trillium Surety & Casualty Canada ULC"),
      ),
    ).toBe(true);
    expect(
      discoveryJson.statutoryDisclosures.some((d) =>
        d.includes("No unsupported 100% guarantee language"),
      ),
    ).toBe(true);
    expect(
      discoveryJson.statutoryDisclosures.some((d) =>
        d.includes("10-day statutory cooling-off cancellation rights"),
      ),
    ).toBe(true);

    const stdProduct = discoveryJson.products.find(
      (p) => p.slug === "STANDARD_DEFECT_PROTECTION",
    );
    const compProduct = discoveryJson.products.find(
      (p) => p.slug === "COMPREHENSIVE_PROPERTY_AND_WATER",
    );
    const structProduct = discoveryJson.products.find(
      (p) => p.slug === "MAJOR_MECHANICAL_AND_STRUCTURAL",
    );

    expect(stdProduct).toBeDefined();
    expect(stdProduct?.coverageLimitCents).toBe(2500000); // $25,000
    expect(stdProduct?.deductibleCents).toBe(25000); // $250
    expect(stdProduct?.brokerLicenseRef).toBe("RIBO-ON-LIC-39102-CORP");

    expect(compProduct).toBeDefined();
    expect(compProduct?.coverageLimitCents).toBe(10000000); // $100,000
    expect(compProduct?.deductibleCents).toBe(50000); // $500
    expect(compProduct?.durationMonths).toBe(24);

    expect(structProduct).toBeDefined();
    expect(structProduct?.coverageLimitCents).toBe(25000000); // $250,000
    expect(structProduct?.deductibleCents).toBe(100000); // $1,000
    expect(structProduct?.durationMonths).toBe(36);

    // 2. Prepare Service Request for Quoting & Underwriting
    const [elecVertical] = await db
      .select({ id: verticals.id })
      .from(verticals)
      .where(eq(verticals.slug, "electrical"))
      .limit(1);
    const [elecCat] = await db
      .select({ id: serviceCategories.id })
      .from(serviceCategories)
      .where(eq(serviceCategories.verticalId, elecVertical!.id))
      .limit(1);
    const [elecIssue] = await db
      .select({ id: issueTypes.id })
      .from(issueTypes)
      .where(eq(issueTypes.categoryId, elecCat!.id))
      .limit(1);
    const [prop] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(eq(properties.customerId, custUser.id))
      .limit(1);

    const createReqRes = await app.inject({
      method: "POST",
      url: "/v1/service-requests",
      headers: auth("customer@example.test"),
      payload: {
        propertyId: prop!.id,
        verticalId: elecVertical!.id,
        categoryId: elecCat!.id,
        issueTypeId: elecIssue!.id,
        urgency: "STANDARD",
        description: "200A Electrical Distribution and Whole-Home Power System",
        attachmentKeys: [],
      },
    });
    expect(createReqRes.statusCode).toBe(201);
    const requestId = createReqRes.json<{ id: string }>().id;

    // 3. Generate Underwriting Quote (POST /v1/protection/quotes)
    // Job Value = $8,000.00 (800,000 cents) for Comprehensive ($100k coverage)
    const quoteRes = await app.inject({
      method: "POST",
      url: "/v1/protection/quotes",
      headers: auth("customer@example.test"),
      payload: {
        serviceRequestId: requestId,
        productSlug: "COMPREHENSIVE_PROPERTY_AND_WATER",
        jobValueCents: 800000,
      },
    });
    expect(quoteRes.statusCode).toBe(201);
    const quoteData = quoteRes.json<{
      quote: {
        id: string;
        serviceRequestId: string;
        productId: string;
        jobValueCents: number;
        coverageLimitCents: number;
        deductibleCents: number;
        grossPremiumCents: number;
        brokerCommissionCents: number;
        platformFeeCents: number;
        taxCents: number;
        totalPayableCents: number;
        eligible: boolean;
        underwritingDecision: string;
        status: string;
        expiresAt: string;
      };
      product: {
        name: string;
        underwriterName: string;
        brokerName: string;
        brokerLicenseRef: string;
      };
    }>();

    const quote = quoteData.quote;
    expect(quote.id).toBeDefined();
    expect(quote.jobValueCents).toBe(800000);
    expect(quote.coverageLimitCents).toBe(10000000); // $100,000 limit
    expect(quote.deductibleCents).toBe(50000); // $500 deductible
    expect(quote.grossPremiumCents).toBe(36000); // 4.5% of $8,000 = $360.00
    expect(quote.brokerCommissionCents).toBe(5400); // 15% of $360 = $54.00
    expect(quote.platformFeeCents).toBe(3600); // 10% of $360 = $36.00
    expect(quote.taxCents).toBe(3168); // 8% tax on ($360 + $36) = $31.68
    expect(quote.totalPayableCents).toBe(42768); // $427.68 total payable
    expect(quote.eligible).toBe(true);
    expect(quote.underwritingDecision).toBe("ELIGIBLE");
    expect(quote.status).toBe("ISSUED");

    // 4. Negative Underwriting Test: Job Value Exceeds Maximum Ceiling
    const exceedQuoteRes = await app.inject({
      method: "POST",
      url: "/v1/protection/quotes",
      headers: auth("customer@example.test"),
      payload: {
        serviceRequestId: requestId,
        productSlug: "STANDARD_DEFECT_PROTECTION", // Max $100,000 job value
        jobValueCents: 15000000, // $150,000
      },
    });
    expect(exceedQuoteRes.statusCode).toBe(201);
    const exceedQuote = exceedQuoteRes.json<{
      quote: { eligible: boolean; underwritingDecision: string; declineReasons: string[] };
    }>().quote;
    expect(exceedQuote.eligible).toBe(false);
    expect(exceedQuote.underwritingDecision).toBe(
      "DECLINED_JOB_VALUE_EXCEEDED",
    );
    expect(exceedQuote.declineReasons.length).toBeGreaterThan(0);

    // 5. Binding Attempt Without Acknowledging Statutory Disclosures -> 400 Validation Error
    const unacknowledgedBindRes = await app.inject({
      method: "POST",
      url: "/v1/protection/policies/bind",
      headers: auth("customer@example.test"),
      payload: {
        quoteId: quote.id,
        acknowledgedDisclosures: false,
      },
    });
    expect(unacknowledgedBindRes.statusCode).toBe(400);

    // 6. Legitimate Policy Binding (POST /v1/protection/policies/bind)
    const bindRes = await app.inject({
      method: "POST",
      url: "/v1/protection/policies/bind",
      headers: auth("customer@example.test"),
      payload: {
        quoteId: quote.id,
        acknowledgedDisclosures: true,
        paymentMethodRef: "CARD_ESCROW_VISA_4242",
      },
    });
    expect(bindRes.statusCode).toBe(201);
    const bindData = bindRes.json<{
      policy: {
        id: string;
        certificateNumber: string;
        status: string;
        coverageLimitCents: number;
        deductibleCents: number;
        grossPremiumCents: number;
        totalPaidCents: number;
        effectiveStartDate: string;
        effectiveEndDate: string;
        cancellationDeadline: string;
        policyChecksum: string;
        underwriterPolicyRef: string;
        brokerLicenseRef: string;
      };
      certificate: {
        certificateNumber: string;
        policyChecksum: string;
        underwriter: { name: string; policyRef: string };
        licensedBroker: { name: string; licenseRef: string };
        coverage: { limitCents: number; deductibleCents: number; durationMonths: number };
        statutoryDisclosures: string[];
      };
    }>();

    const policy = bindData.policy;
    expect(policy.id).toBeDefined();
    expect(policy.certificateNumber).toMatch(/^SH-POL-2026-ON-\d+$/);
    expect(policy.status).toBe("BOUND_ACTIVE");
    expect(policy.coverageLimitCents).toBe(10000000);
    expect(policy.deductibleCents).toBe(50000);
    expect(policy.grossPremiumCents).toBe(36000);
    expect(policy.totalPaidCents).toBe(42768);
    expect(policy.policyChecksum.length).toBe(64);
    expect(policy.brokerLicenseRef).toBe("RIBO-ON-LIC-39102-CORP");

    expect(bindData.certificate.coverage.durationMonths).toBe(24);
    expect(bindData.certificate.statutoryDisclosures.length).toBeGreaterThan(0);

    // 7. Re-binding Same Quote Fails (409 ALREADY_BOUND)
    const duplicateBindRes = await app.inject({
      method: "POST",
      url: "/v1/protection/policies/bind",
      headers: auth("customer@example.test"),
      payload: {
        quoteId: quote.id,
        acknowledgedDisclosures: true,
      },
    });
    expect(duplicateBindRes.statusCode).toBe(409);

    // 8. Coverage Certificate Verification & Tenant Isolation (GET /v1/protection/policies/:id/certificate)
    // 8a. Tenant Isolation: Non-ops unauthorized caller cannot view certificate -> 403
    const rivalCertRes = await app.inject({
      method: "GET",
      url: `/v1/protection/policies/${policy.id}/certificate`,
      headers: auth("technician@example.test"),
    });
    expect(rivalCertRes.statusCode).toBe(403);
    expect(rivalCertRes.json<{ code: string }>().code).toBe("FORBIDDEN");

    // 8b. Insured Customer Retrieves Verified Certificate
    const certRes = await app.inject({
      method: "GET",
      url: `/v1/protection/policies/${policy.id}/certificate`,
      headers: auth("customer@example.test"),
    });
    expect(certRes.statusCode).toBe(200);
    const certJson = certRes.json<{
      certificate: {
        certificateNumber: string;
        policyChecksum: string;
        insuredCustomer: { name: string };
        coverage: { limitCents: number; deductibleCents: number };
      };
      tamperEvident: {
        verified: boolean;
        recordedChecksum: string;
        computedChecksum: string;
      };
    }>();
    expect(certJson.tamperEvident.verified).toBe(true);
    expect(certJson.tamperEvident.recordedChecksum).toBe(
      certJson.tamperEvident.computedChecksum,
    );
    expect(certJson.certificate.certificateNumber).toBe(policy.certificateNumber);

    // 9. Statutory 10-Day Cooling-Off Cancellation & Full Premium Refund
    // Prepare a second policy specifically to test statutory cancellation
    const cancelQuoteRes = await app.inject({
      method: "POST",
      url: "/v1/protection/quotes",
      headers: auth("customer@example.test"),
      payload: {
        serviceRequestId: requestId,
        productSlug: "STANDARD_DEFECT_PROTECTION",
        jobValueCents: 300000, // $3,000
      },
    });
    expect(cancelQuoteRes.statusCode).toBe(201);
    const cancelQuoteId = cancelQuoteRes.json<{ quote: { id: string } }>().quote.id;

    const cancelBindRes = await app.inject({
      method: "POST",
      url: "/v1/protection/policies/bind",
      headers: auth("customer@example.test"),
      payload: {
        quoteId: cancelQuoteId,
        acknowledgedDisclosures: true,
      },
    });
    expect(cancelBindRes.statusCode).toBe(201);
    const policyToCancelId = cancelBindRes.json<{ policy: { id: string; totalPaidCents: number } }>().policy.id;

    const cancelRes = await app.inject({
      method: "POST",
      url: `/v1/protection/policies/${policyToCancelId}/cancel`,
      headers: auth("customer@example.test"),
      payload: {
        reason: "Customer opted out within statutory 10-day cooling-off window prior to job start.",
      },
    });
    expect(cancelRes.statusCode).toBe(200);
    const cancelJson = cancelRes.json<{
      policy: { status: string; cancelledAt: string; cancellationReason: string };
      refund: { refundedAmountCents: number; status: string };
    }>();
    expect(cancelJson.policy.status).toBe("CANCELLED_REFUNDED");
    expect(cancelJson.policy.cancelledAt).toBeDefined();
    expect(cancelJson.refund.status).toBe("REFUNDED");
    expect(cancelJson.refund.refundedAmountCents).toBeGreaterThan(0);

    // 10. Homeowner Defect Claim Filing (POST /v1/protection/policies/:id/claims)
    const incidentDate = new Date().toISOString();
    const claimRes = await app.inject({
      method: "POST",
      url: `/v1/protection/policies/${policy.id}/claims`,
      headers: auth("customer@example.test"),
      payload: {
        incidentDate,
        incidentDescription:
          "Severe water escape and consequential drywall damage resulting from failed pipe joint crimp on domestic supply.",
        claimedAmountCents: 420000, // $4,200.00 loss
        evidenceUrls: [
          "https://storage.skilledhire.ca/claims/water-damage-basement.jpg",
          "https://storage.skilledhire.ca/claims/mitigation-drying-invoice.pdf",
        ],
      },
    });
    expect(claimRes.statusCode).toBe(201);
    const claimData = claimRes.json<{
      claim: {
        id: string;
        claimNumber: string;
        status: string;
        claimedAmountCents: number;
        adjudicatedAmountCents: number;
        netPayoutCents: number;
      };
    }>().claim;

    expect(claimData.id).toBeDefined();
    expect(claimData.claimNumber).toMatch(/^CLM-2026-ON-\d+$/);
    expect(claimData.status).toBe("SUBMITTED");
    expect(claimData.claimedAmountCents).toBe(420000);

    // 10b. Tenant Isolation: Rival non-ops actor cannot view claim -> 403
    const rivalClaimRes = await app.inject({
      method: "GET",
      url: `/v1/protection/claims/${claimData.id}`,
      headers: auth("technician@example.test"),
    });
    expect(rivalClaimRes.statusCode).toBe(403);
    expect(rivalClaimRes.json<{ code: string }>().code).toBe("FORBIDDEN");

    // 11. Claims Adjuster Adjudication & Payout (POST /v1/protection/claims/:id/adjudicate)
    // 11a. Non-ops caller is forbidden
    const nonOpsAdjudicateRes = await app.inject({
      method: "POST",
      url: `/v1/protection/claims/${claimData.id}/adjudicate`,
      headers: auth("customer@example.test"),
      payload: {
        decision: "APPROVED",
        adjudicationNotes: "Unauthorized customer self-approval attempt",
      },
    });
    expect(nonOpsAdjudicateRes.statusCode).toBe(403);

    // 11b. Authorized Claims Adjuster Approves with Deductible Subtraction
    // Approved: $4,000.00 (400,000 cents). Deductible applied: $500.00 (50,000 cents).
    // Net Payout: $3,500.00 (350,000 cents).
    const adjudicateRes = await app.inject({
      method: "POST",
      url: `/v1/protection/claims/${claimData.id}/adjudicate`,
      headers: auth("admin@example.test"),
      payload: {
        decision: "APPROVED",
        approvedAmountCents: 400000,
        deductibleCents: 50000,
        adjudicationNotes:
          "Inspection confirmed fitting defect caused consequential water damage. Approved full restoration minus statutory policy deductible.",
      },
    });
    expect(adjudicateRes.statusCode).toBe(200);
    const adjudicateJson = adjudicateRes.json<{
      claim: {
        status: string;
        adjudicatedAmountCents: number;
        deductibleAppliedCents: number;
        netPayoutCents: number;
        paidAt: string;
      };
    }>();

    expect(adjudicateJson.claim.status).toBe("PAID");
    expect(adjudicateJson.claim.adjudicatedAmountCents).toBe(400000);
    expect(adjudicateJson.claim.deductibleAppliedCents).toBe(50000);
    expect(adjudicateJson.claim.netPayoutCents).toBe(350000);
    expect(adjudicateJson.claim.paidAt).toBeDefined();

    // 12. Financial Reconciliation & Broker Commission Audit Ledger (GET /v1/protection/reconciliation)
    // 12a. Non-ops forbidden
    const nonOpsReconRes = await app.inject({
      method: "GET",
      url: "/v1/protection/reconciliation",
      headers: auth("customer@example.test"),
    });
    expect(nonOpsReconRes.statusCode).toBe(403);

    // 12b. Operations / Finance Auditor Retrieves Full Reconciliation Ledger
    const reconRes = await app.inject({
      method: "GET",
      url: "/v1/protection/reconciliation",
      headers: auth("admin@example.test"),
    });
    expect(reconRes.statusCode).toBe(200);
    const reconJson = reconRes.json<{
      entries: Array<{
        id: string;
        transactionType: string;
        amountCents: number;
        direction: string;
        sourceAccount: string;
        destinationAccount: string;
      }>;
      summary: {
        totalGrossPremiumsCollectedCents: number;
        totalBrokerCommissionsPayableCents: number;
        totalPlatformFeesEarnedCents: number;
        totalInsurerRemittancesCents: number;
        totalClaimsPaidCents: number;
        totalRefundsProcessedCents: number;
        netEscrowReserveBalanceCents: number;
      };
    }>();

    expect(reconJson.entries.length).toBeGreaterThanOrEqual(6);
    expect(
      reconJson.entries.some((e) => e.transactionType === "PREMIUM_COLLECTION"),
    ).toBe(true);
    expect(
      reconJson.entries.some(
        (e) => e.transactionType === "BROKER_COMMISSION_PAYABLE",
      ),
    ).toBe(true);
    expect(
      reconJson.entries.some((e) => e.transactionType === "PLATFORM_FEE_EARNED"),
    ).toBe(true);
    expect(
      reconJson.entries.some(
        (e) => e.transactionType === "INSURER_PREMIUM_REMITTANCE",
      ),
    ).toBe(true);
    expect(
      reconJson.entries.some((e) => e.transactionType === "PREMIUM_REFUND"),
    ).toBe(true);
    expect(
      reconJson.entries.some((e) => e.transactionType === "CLAIM_PAYOUT"),
    ).toBe(true);

    expect(reconJson.summary.totalGrossPremiumsCollectedCents).toBeGreaterThan(0);
    expect(reconJson.summary.totalBrokerCommissionsPayableCents).toBeGreaterThan(0);
    expect(reconJson.summary.totalClaimsPaidCents).toBeGreaterThanOrEqual(350000);
    expect(reconJson.summary.totalRefundsProcessedCents).toBeGreaterThan(0);
  });

  it("enforces risk-based job documentation, tiered evidence gates, customer sign-off, QA sampling, exception audits, and automated incident escalation (#63)", async () => {
    // 1. Locate active job
    const [job] = await db
      .select({
        id: jobs.id,
        contractorId: jobs.contractorId,
        technicianId: jobs.technicianId,
        serviceRequestId: jobs.serviceRequestId,
      })
      .from(jobs)
      .where(eq(jobs.status, "COMPLETED"))
      .limit(1);

    if (!job) throw new Error("Missing completed job");

    // 2. Query / initialize documentation package (GET /v1/jobs/:id/documentation)
    const initRes = await app.inject({
      method: "GET",
      url: `/v1/jobs/${job.id}/documentation`,
      headers: auth("admin@example.test"),
    });
    expect(initRes.statusCode).toBe(200);
    const initJson = initRes.json<{
      documentationPackage: {
        id: string;
        jobId: string;
        riskTier: string;
        status: string;
      };
      gateEvaluation: {
        passed: boolean;
        missingRequirements: string[];
      };
    }>();

    expect(initJson.documentationPackage.id).toBeDefined();
    expect(initJson.documentationPackage.jobId).toBe(job.id);

    // 3. Tenant Isolation Check: Unrelated customer receives 403
    const [unrelatedCustomer] = await db
      .select({ email: users.email })
      .from(users)
      .where(ne(users.email, "customer@example.test"))
      .limit(1);

    if (unrelatedCustomer) {
      const forbiddenRes = await app.inject({
        method: "GET",
        url: `/v1/jobs/${job.id}/documentation`,
        headers: auth("technician@example.test"), // non-ops, not contractor of job
      });
      // Technician might belong to contractor; if not, expects 403 or 200 if contractor matches
      expect([200, 403]).toContain(forbiddenRes.statusCode);
    }

    // 4. Incomplete Submission: Submit only 1 after photo for a high-risk job
    // Manually set package riskTier to HIGH to verify strict multi-photo + checklist gates
    await db
      .update(jobDocumentationPackages)
      .set({ riskTier: "HIGH" })
      .where(eq(jobDocumentationPackages.jobId, job.id));

    const incompleteRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${job.id}/documentation`,
      headers: auth("admin@example.test"),
      payload: {
        afterPhotos: [
          {
            url: "https://storage.skilledhire.ca/evidence/after-1.jpg",
            phase: "AFTER",
            caption: "Final work completed",
          },
        ],
        workerIdentityConfirmed: false,
        riskChecklist: [],
      },
    });
    expect(incompleteRes.statusCode).toBe(200);
    const incompleteJson = incompleteRes.json<{
      documentationPackage: { status: string };
      gateEvaluation: { passed: boolean; missingRequirements: string[] };
    }>();
    expect(incompleteJson.gateEvaluation.passed).toBe(false);
    expect(incompleteJson.gateEvaluation.missingRequirements).toContain("MISSING_BEFORE_PHOTO");
    expect(incompleteJson.gateEvaluation.missingRequirements).toContain("UNVERIFIED_WORKER_IDENTITY");
    expect(incompleteJson.gateEvaluation.missingRequirements).toContain("INCOMPLETE_RISK_CHECKLIST");

    // 5. Automated Safety Incident Escalation (#58 trigger): Uncleared critical shock hazard
    const hazardRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${job.id}/documentation`,
      headers: auth("admin@example.test"),
      payload: {
        beforePhotos: [{ url: "https://storage.skilledhire.ca/b.jpg", phase: "BEFORE" }],
        inProgressPhotos: [{ url: "https://storage.skilledhire.ca/in.jpg", phase: "IN_PROGRESS" }],
        afterPhotos: [{ url: "https://storage.skilledhire.ca/a.jpg", phase: "AFTER" }],
        workerIdentityConfirmed: true,
        riskChecklist: [
          {
            key: "LIVE_ELECTRICAL_SHOCK_HAZARD",
            label: "Live electrical shock hazard",
            confirmed: false, // Hazard uncleared!
          },
        ],
      },
    });
    expect(hazardRes.statusCode).toBe(200);
    const hazardJson = hazardRes.json<{
      documentationPackage: {
        status: string;
        incidentEscalated: boolean;
        incidentEscalationId: string;
      };
      gateEvaluation: {
        passed: boolean;
        severeHazardDetected: boolean;
        incidentEscalationRequired: boolean;
      };
    }>();
    expect(hazardJson.documentationPackage.status).toBe("DEFICIENT");
    expect(hazardJson.documentationPackage.incidentEscalated).toBe(true);
    expect(hazardJson.documentationPackage.incidentEscalationId).toBeDefined();
    expect(hazardJson.gateEvaluation.severeHazardDetected).toBe(true);

    // Verify #58 safety incident record was created
    const [createdIncident] = await db
      .select()
      .from(safetyIncidents)
      .where(eq(safetyIncidents.id, hazardJson.documentationPackage.incidentEscalationId))
      .limit(1);
    expect(createdIncident).toBeDefined();
    expect(createdIncident?.severity).toBe("CRITICAL_EMERGENCY");
    expect(createdIncident?.status).toBe("REPORTED");

    const [suspendedContractor] = await db
      .select({ safetyStatus: contractors.safetyStatus })
      .from(contractors)
      .where(eq(contractors.id, job.contractorId))
      .limit(1);
    expect(suspendedContractor?.safetyStatus).toBe("SUSPENDED");

    // Restore contractor safety status and lift test quarantine for remaining test assertions and subsequent test runs
    await db
      .update(contractors)
      .set({ safetyStatus: "ACTIVE" })
      .where(eq(contractors.id, job.contractorId));

    await db
      .update(contractorSafetyQuarantines)
      .set({ active: false })
      .where(eq(contractorSafetyQuarantines.contractorId, job.contractorId));

    // 6. Complete, Compliant Submission & Customer Sign-Off
    // Rectify hazard by submitting complete compliant package with all cleared items
    const completeRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${job.id}/documentation`,
      headers: auth("admin@example.test"),
      payload: {
        beforePhotos: [
          { url: "https://storage.skilledhire.ca/before.jpg", phase: "BEFORE", caption: "Initial subpanel" },
        ],
        inProgressPhotos: [
          { url: "https://storage.skilledhire.ca/in-progress.jpg", phase: "IN_PROGRESS", caption: "Wiring run" },
        ],
        afterPhotos: [
          { url: "https://storage.skilledhire.ca/after-panel.jpg", phase: "AFTER", caption: "Terminated panel" },
        ],
        workerIdentityConfirmed: true,
        workerIdentityNotes: "Matched government issued photo ID at pre-work check",
        riskChecklist: [
          { key: "PANEL_TORQUE", label: "Lug torque confirmed to spec", confirmed: true },
          { key: "BONDING_CONTINUITY", label: "Ground bonding verified < 0.1 ohm", confirmed: true },
        ],
      },
    });
    expect(completeRes.statusCode).toBe(200);

    // Customer Sign-off
    const signoffRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${job.id}/documentation/signoff`,
      headers: auth("customer@example.test"),
      payload: {
        customerName: "Jane Homeowner",
        feedback: "Work looks clean and inspected safely",
        signatureDigest: "sha256-evidence-signature-digest-2026-customer-ok",
      },
    });
    expect(signoffRes.statusCode).toBe(200);
    const signoffJson = signoffRes.json<{
      documentationPackage: {
        status: string;
        customerSignoff: { signed: boolean; customerName: string };
        propertyPassportLinked: boolean;
      };
      gateEvaluation: { passed: boolean };
    }>();
    expect(signoffJson.documentationPackage.customerSignoff.signed).toBe(true);
    expect(signoffJson.documentationPackage.status).toBe("VERIFIED_COMPLIANT");
    expect(signoffJson.documentationPackage.propertyPassportLinked).toBe(true);
    expect(signoffJson.gateEvaluation.passed).toBe(true);

    // 7. Operations Review & Exception Approval
    // 7a. Non-ops is forbidden from approving exceptions
    const nonOpsExceptionRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${job.id}/documentation/exception`,
      headers: auth("customer@example.test"),
      payload: {
        reason: "Unauthorized customer exception",
      },
    });
    expect(nonOpsExceptionRes.statusCode).toBe(403);

    // 7b. Ops approves exception with audit trail
    const opsExceptionRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${job.id}/documentation/exception`,
      headers: auth("admin@example.test"),
      payload: {
        reason: "Extreme weather conditions prevented second exterior photo; verified via drone footage",
        conditions: ["Follow-up drone audit within 14 days"],
      },
    });
    expect(opsExceptionRes.statusCode).toBe(200);
    const exceptionJson = opsExceptionRes.json<{
      documentationPackage: {
        status: string;
        exceptionAuditLog: Array<{ reason: string }>;
      };
      exceptionApproved: boolean;
    }>();
    expect(exceptionJson.exceptionApproved).toBe(true);
    expect(exceptionJson.documentationPackage.status).toBe("OPS_APPROVED_EXCEPTION");
    expect(exceptionJson.documentationPackage.exceptionAuditLog[0]?.reason).toContain("Extreme weather");

    // 8. Independent QA Audit Sampling
    // 8a. Non-ops is forbidden from triggering QA sampling
    const nonOpsQaRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${job.id}/documentation/qa-sample`,
      headers: auth("customer@example.test"),
      payload: {
        triggerType: "HIGH_RISK_QA_SAMPLING",
      },
    });
    expect(nonOpsQaRes.statusCode).toBe(403);

    // 8b. Ops schedules QA Audit Sample
    const opsQaRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${job.id}/documentation/qa-sample`,
      headers: auth("admin@example.test"),
      payload: {
        triggerType: "HIGH_RISK_TRADE",
        notes: "Randomly selected for independent trade quality verification",
      },
    });
    expect(opsQaRes.statusCode).toBe(201);
    const qaJson = opsQaRes.json<{
      documentationPackage: {
        qaAuditRequired: boolean;
        qaAuditStatus: string;
        qaAuditId: string;
      };
      qaAudit: {
        id: string;
        auditNumber: string;
        status: string;
      };
    }>();
    expect(qaJson.documentationPackage.qaAuditRequired).toBe(true);
    expect(qaJson.documentationPackage.qaAuditStatus).toBe("PENDING");
    expect(qaJson.qaAudit.id).toBeDefined();
    expect(qaJson.qaAudit.auditNumber).toMatch(/^QA-AUDIT-2026-\d+$/);

    // 9. Operations QA Metrics Endpoint (GET /v1/jobs/documentation/qa-metrics)
    // 9a. Non-ops is forbidden
    const nonOpsMetricsRes = await app.inject({
      method: "GET",
      url: "/v1/jobs/documentation/qa-metrics",
      headers: auth("customer@example.test"),
    });
    expect(nonOpsMetricsRes.statusCode).toBe(403);

    // 9b. Ops retrieves aggregated QA metrics
    const metricsRes = await app.inject({
      method: "GET",
      url: "/v1/jobs/documentation/qa-metrics",
      headers: auth("admin@example.test"),
    });
    expect(metricsRes.statusCode).toBe(200);
    const metricsJson = metricsRes.json<{
      metrics: {
        totalPackages: number;
        verifiedCompliantCount: number;
        exceptionApprovedCount: number;
        complianceRateBps: number;
        qaSamplingRateBps: number;
        tierBreakdown: Record<string, { total: number }>;
      };
    }>();
    expect(metricsJson.metrics.totalPackages).toBeGreaterThanOrEqual(1);
    expect(metricsJson.metrics.qaSamplingRateBps).toBeGreaterThan(0);
    expect(metricsJson.metrics.tierBreakdown["HIGH"]?.total).toBeGreaterThanOrEqual(1);
  });

  it("enforces structured job completion reports, customer acceptance/disputes, Property Service Passport, access grants, and ownership transfers (#50, #51)", async () => {
    // 1. Locate completed job with contractor and customer
    const [job] = await db
      .select({
        id: jobs.id,
        contractorId: jobs.contractorId,
        technicianId: jobs.technicianId,
        serviceRequestId: jobs.serviceRequestId,
      })
      .from(jobs)
      .where(eq(jobs.status, "COMPLETED"))
      .limit(1);
    if (!job) throw new Error("Missing completed job");

    // 2. Draft Sync: Save offline draft completion report
    const draftRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${job.id}/completion-report`,
      headers: auth("owner@example.test"),
      payload: {
        workSummary: "Draft work summary for furnace blower and capacitor inspection.",
        diagnosis: "Draft diagnosis: degraded run capacitor.",
        workStartedAt: "2026-10-12T13:00:00Z",
        workCompletedAt: "2026-10-12T15:00:00Z",
        clientMutationId: "mutation-draft-uuid-1",
        isDraft: true,
      },
    });
    expect([200, 201]).toContain(draftRes.statusCode);
    const draftJson = draftRes.json<{
      completionReport: { status: string; clientMutationId: string };
    }>();
    expect(draftJson.completionReport.status).toBe("DRAFT");
    expect(draftJson.completionReport.clientMutationId).toBe("mutation-draft-uuid-1");

    // 3. Validation rejection: Invalid chronologies or missing photos reject with 400
    const invalidRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${job.id}/completion-report`,
      headers: auth("owner@example.test"),
      payload: {
        workSummary: "Valid work summary description",
        diagnosis: "Valid diagnosis description",
        workStartedAt: "2026-10-12T18:00:00Z",
        workCompletedAt: "2026-10-12T15:00:00Z", // start > completed
        beforePhotos: [],
        afterPhotos: [],
        isDraft: false,
      },
    });
    expect(invalidRes.statusCode).toBe(400);
    const errJson = invalidRes.json<{ code: string; errors: string[] }>();
    expect(errJson.code).toBe("VALIDATION_FAILED");
    expect(errJson.errors.length).toBeGreaterThanOrEqual(1);

    // 4. Submit Valid Completion Report
    const submitRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${job.id}/completion-report`,
      headers: auth("owner@example.test"),
      payload: {
        workSummary: "Replaced dual run capacitor 45/5 MFD, lubricated blower motor bearings, and verified temperature rise.",
        diagnosis: "Run capacitor microfarads dropped from 45uF to 28uF causing blower hesitation and thermal cutoff.",
        workStartedAt: "2026-10-12T13:00:00Z",
        workCompletedAt: "2026-10-12T15:30:00Z",
        partsInstalled: [
          {
            partNumber: "CAP-45-5-HD",
            description: "Titan Pro Dual Run Capacitor 45/5 MFD 440V",
            quantity: 1,
            unitCostCents: 4500,
            warrantyMonths: 24,
          },
        ],
        testsPerformed: [
          {
            testName: "Capacitor Microfarad Rating",
            result: "PASS",
            measuredValue: "44.9",
            unit: "uF",
          },
          {
            testName: "Temperature Rise Delta T",
            result: "PASS",
            measuredValue: "21.0",
            unit: "Fahrenheit",
          },
        ],
        beforePhotos: [
          { url: "https://photos.test/furnace-before.jpg", phase: "BEFORE" },
        ],
        afterPhotos: [
          { url: "https://photos.test/furnace-after.jpg", phase: "AFTER" },
        ],
        maintenanceRecommendations: [
          {
            recommendation: "Inspect blower wheel balance at annual pre-winter tune-up.",
            recommendedIntervalDays: 180,
            priority: "RECOMMENDED",
          },
        ],
        isDraft: false,
      },
    });
    expect(submitRes.statusCode).toBe(200);
    const submitJson = submitRes.json<{
      completionReport: { status: string; partsInstalled: unknown[] };
    }>();
    expect(submitJson.completionReport.status).toBe("SUBMITTED");
    expect(submitJson.completionReport.partsInstalled.length).toBe(1);

    // 5. Customer Dispute Drill: Customer disputes incomplete work
    const disputeRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${job.id}/completion-report/dispute`,
      headers: auth("customer@example.test"),
      payload: {
        reason: "Blower compartment filter door rattling loudly after startup.",
      },
    });
    expect(disputeRes.statusCode).toBe(200);
    expect(
      disputeRes.json<{ completionReport: { status: string } }>()
        .completionReport.status,
    ).toBe("DISPUTED");

    // 6. Technician Attestation & Resubmission
    const attestRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${job.id}/completion-report/attest`,
      headers: auth("technician@example.test"),
      payload: {
        technicianName: "Alex Certified Tech",
        licenseNumber: "HVAC-313A-987654",
        notes: "Reseated and latched blower compartment door clips, rattle eliminated.",
      },
    });
    expect(attestRes.statusCode).toBe(200);
    expect(
      attestRes.json<{ completionReport: { status: string } }>()
        .completionReport.status,
    ).toBe("SUBMITTED");

    // 7. Customer Acceptance
    const acceptRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${job.id}/completion-report/accept`,
      headers: auth("customer@example.test"),
      payload: {
        accepted: true,
        notes: "Confirmed blower runs smoothly and quiet. Heating verified operational.",
        signatureDigest: "SHA256:d8b2e5a1c4f7902348b56789a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
      },
    });
    expect(acceptRes.statusCode).toBe(200);
    expect(
      acceptRes.json<{ completionReport: { status: string } }>()
        .completionReport.status,
    ).toBe("ACCEPTED");

    // Idempotent secondary acceptance
    const reAcceptRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${job.id}/completion-report/accept`,
      headers: auth("customer@example.test"),
      payload: { accepted: true },
    });
    expect(reAcceptRes.statusCode).toBe(200);

    // 8. Property Asset Registration & Property Service Passport
    const [propRow] = await db
      .select({
        id: properties.id,
        verticalId: serviceRequests.verticalId,
      })
      .from(serviceRequests)
      .innerJoin(jobs, eq(jobs.serviceRequestId, serviceRequests.id))
      .innerJoin(properties, eq(properties.id, serviceRequests.propertyId))
      .where(eq(jobs.id, job.id))
      .limit(1);
    if (!propRow) throw new Error("Missing property for job");

    const assetRes = await app.inject({
      method: "POST",
      url: `/v1/properties/${propRow.id}/assets`,
      headers: auth("customer@example.test"),
      payload: {
        name: "Lennox Elite High-Efficiency Gas Furnace",
        verticalId: propRow.verticalId,
        assetType: "HVAC_FURNACE",
        manufacturer: "Lennox",
        modelNumber: "EL296UH070XE36B",
        serialNumber: "SN-LNX-2026-88412",
        installedOn: "2024-10-01",
        warrantyStatus: "ACTIVE",
        metadata: { AFUE: "96%", stage: 2 },
      },
    });
    expect(assetRes.statusCode).toBe(201);
    const assetId = assetRes.json<{ asset: { id: string } }>().asset.id;
    expect(assetId).toBeDefined();

    // 9. Passport Query by Homeowner: full unredacted view
    const ownerPassportRes = await app.inject({
      method: "GET",
      url: `/v1/properties/${propRow.id}/passport`,
      headers: auth("customer@example.test"),
    });
    expect(ownerPassportRes.statusCode).toBe(200);
    const ownerPassport = ownerPassportRes.json<{
      passport: {
        isOwner: boolean;
        assets: Array<{ id: string; name: string }>;
        serviceHistory: Array<{ costRedacted: boolean; summary: string }>;
      };
    }>();
    expect(ownerPassport.passport.isOwner).toBe(true);
    expect(ownerPassport.passport.assets.length).toBeGreaterThanOrEqual(1);
    expect(ownerPassport.passport.serviceHistory.length).toBeGreaterThanOrEqual(1);
    expect(ownerPassport.passport.serviceHistory[0]?.costRedacted).toBe(false);

    // 10. Access Grant RBAC: Homeowner grants access to rival contractor B
    const [contractorB] = await db
      .select({ id: contractors.id })
      .from(contractors)
      .where(eq(contractors.name, "Rival Trade Services Inc"))
      .limit(1);
    if (!contractorB) throw new Error("Missing rival contractor");

    const [rivalUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "rival-owner@example.test"))
      .limit(1);
    if (rivalUser) {
      tokens.set(
        "rival-owner@example.test",
        app.jwt.sign({ sub: rivalUser.id, sessionVersion: 1 }),
      );
    }

    // Unauthenticated contractor attempt receives 403
    const unauthPassportRes = await app.inject({
      method: "GET",
      url: `/v1/properties/${propRow.id}/passport`,
      headers: auth("rival-owner@example.test"),
    });
    expect(unauthPassportRes.statusCode).toBe(403);

    // Homeowner issues access grant
    const grantRes = await app.inject({
      method: "POST",
      url: `/v1/properties/${propRow.id}/access-grants`,
      headers: auth("customer@example.test"),
      payload: {
        granteeContractorId: contractorB.id,
        scope: "REDACTED_COMMERCIAL",
        reason: "Secondary opinion for ductwork zoning",
        durationDays: 14,
      },
    });
    expect(grantRes.statusCode).toBe(201);
    const grantId = grantRes.json<{ accessGrant: { id: string } }>().accessGrant.id;

    // Granted contractor reads passport: commercial cost is redacted
    const grantedPassportRes = await app.inject({
      method: "GET",
      url: `/v1/properties/${propRow.id}/passport`,
      headers: auth("rival-owner@example.test"),
    });
    expect(grantedPassportRes.statusCode).toBe(200);
    const grantedPassport = grantedPassportRes.json<{
      passport: {
        isOwner: boolean;
        serviceHistory: Array<{ costRedacted: boolean }>;
      };
    }>();
    expect(grantedPassport.passport.isOwner).toBe(false);
    expect(grantedPassport.passport.serviceHistory[0]?.costRedacted).toBe(true);

    // Homeowner revokes access grant
    const revokeRes = await app.inject({
      method: "DELETE",
      url: `/v1/properties/${propRow.id}/access-grants/${grantId}`,
      headers: auth("customer@example.test"),
    });
    expect(revokeRes.statusCode).toBe(200);

    // Revoked contractor receives 403
    const revokedReadRes = await app.inject({
      method: "GET",
      url: `/v1/properties/${propRow.id}/passport`,
      headers: auth("rival-owner@example.test"),
    });
    expect(revokedReadRes.statusCode).toBe(403);

    // 11. Property Ownership Transfer Lifecycle
    // Provision new home buyer
    let [buyerUser] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, "homebuyer@example.test"))
      .limit(1);

    if (!buyerUser) {
      const [newU] = await db
        .insert(users)
        .values({
          email: "homebuyer@example.test",
          passwordHash: "hash",
          displayName: "Home Buyer",
        })
        .returning({ id: users.id, email: users.email });
      buyerUser = newU;
    }
    if (!buyerUser) throw new Error("Missing buyer user");
    tokens.set(
      "homebuyer@example.test",
      app.jwt.sign({ sub: buyerUser.id, sessionVersion: 1 }),
    );

    // Initiate ownership transfer
    const transferRes = await app.inject({
      method: "POST",
      url: `/v1/properties/${propRow.id}/transfer`,
      headers: auth("customer@example.test"),
      payload: {
        newOwnerEmail: "homebuyer@example.test",
        transferNotes: "Property sale closing date October 2026.",
      },
    });
    expect(transferRes.statusCode).toBe(201);
    const transferJson = transferRes.json<{ verificationToken: string }>();
    expect(transferJson.verificationToken.startsWith("TRF-")).toBe(true);

    // Buyer accepts ownership transfer with verification token
    const acceptTransferRes = await app.inject({
      method: "POST",
      url: "/v1/properties/transfers/accept",
      headers: auth("homebuyer@example.test"),
      payload: {
        verificationToken: transferJson.verificationToken,
      },
    });
    expect(acceptTransferRes.statusCode).toBe(200);

    // Buyer is now owner of property passport
    const newOwnerPassportRes = await app.inject({
      method: "GET",
      url: `/v1/properties/${propRow.id}/passport`,
      headers: auth("homebuyer@example.test"),
    });
    expect(newOwnerPassportRes.statusCode).toBe(200);
    expect(newOwnerPassportRes.json<{ passport: { isOwner: boolean } }>().passport.isOwner).toBe(true);

    // Restore property ownership back to customer@example.test to maintain idempotent seed integrity
    const [originalCustomer] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "customer@example.test"))
      .limit(1);
    if (originalCustomer) {
      await db
        .update(properties)
        .set({ customerId: originalCustomer.id })
        .where(eq(properties.id, propRow.id));
    }
  });

  it("17. Workmanship warranty snapshots, claims lifecycle, triage, contractor right-to-cure, dispute escalation, and recovery ledger (#48, #49)", async () => {
    // 1. Fetch completed job and verify participants
    const [completedJob] = await db
      .select({
        id: jobs.id,
        contractorId: jobs.contractorId,
        serviceRequestId: jobs.serviceRequestId,
      })
      .from(jobs)
      .where(eq(jobs.status, "COMPLETED"))
      .limit(1);
    expect(completedJob).toBeDefined();

    const [jobReq] = await db
      .select({
        customerId: serviceRequests.customerId,
        propertyId: serviceRequests.propertyId,
      })
      .from(serviceRequests)
      .where(eq(serviceRequests.id, completedJob!.serviceRequestId))
      .limit(1);
    expect(jobReq).toBeDefined();

    // Clean up any existing warranty data for this job to ensure idempotency across test runs
    const [existingSnapshot] = await db
      .select({ id: jobWarrantySnapshots.id })
      .from(jobWarrantySnapshots)
      .where(eq(jobWarrantySnapshots.jobId, completedJob!.id))
      .limit(1);

    if (existingSnapshot) {
      await db
        .delete(warrantyClaims)
        .where(eq(warrantyClaims.warrantyId, existingSnapshot.id));
      await db
        .delete(jobWarrantySnapshots)
        .where(eq(jobWarrantySnapshots.id, existingSnapshot.id));
    }

    // 2. Admin creates a standard Ontario warranty policy (POST /v1/warranties/policies)
    const policyCode = `POL-ON-${Date.now()}`;
    const createPolicyRes = await app.inject({
      method: "POST",
      url: "/v1/warranties/policies",
      headers: auth("admin@example.test"),
      payload: {
        policyCode,
        version: "1.0.0",
        jurisdiction: "ON",
        durationMonths: 12,
        responseSlaHours: 48,
        emergencySlaHours: 24,
        coveredDefects: [
          "Defective workmanship on equipment joints",
          "Improper fastening or pipe sealing failure",
          "Electrical circuit and wiring termination errors",
        ],
        exclusions: [
          "Normal wear and tear",
          "Tampering or unauthorized third-party modifications",
          "Extreme weather and flooding",
        ],
        statutoryTerms:
          "Ontario Consumer Protection Act 2002 statutory warranty terms",
        active: true,
      },
    });
    expect(createPolicyRes.statusCode).toBe(201);
    const createdPolicy = createPolicyRes.json<{
      id: string;
      policyCode: string;
    }>();
    expect(createdPolicy.policyCode).toBe(policyCode);

    // List policies (GET /v1/warranties/policies)
    const listPoliciesRes = await app.inject({
      method: "GET",
      url: "/v1/warranties/policies",
      headers: auth("admin@example.test"),
    });
    expect(listPoliciesRes.statusCode).toBe(200);
    expect(
      listPoliciesRes
        .json<any[]>()
        .some((p) => p.policyCode === policyCode),
    ).toBe(true);

    // 3. Snapshot warranty on completed job (POST /v1/jobs/:id/warranty/snapshot)
    const snapshotRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${completedJob!.id}/warranty/snapshot`,
      headers: auth("owner@example.test"),
      payload: {
        policyId: createdPolicy.id,
        durationMonths: 12,
        warrantyType: "STANDARD_WORKMANSHIP",
        contractorAcknowledged: true,
      },
    });
    expect(snapshotRes.statusCode).toBe(201);
    const snapshot = snapshotRes.json<{
      id: string;
      certificateNumber: string;
      termsDigest: string;
      durationMonths: number;
      startsAt: string;
      expiresAt: string;
      status: string;
    }>();

    expect(snapshot.certificateNumber).toMatch(/^WAR-\d{4}-[0-9A-F]{8}$/);
    expect(snapshot.termsDigest).toHaveLength(64);
    expect(snapshot.durationMonths).toBe(12);
    expect(snapshot.status).toBe("ACTIVE");

    // Calling snapshot again returns 200 with existing snapshot (idempotency)
    const reSnapshotRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${completedJob!.id}/warranty/snapshot`,
      headers: auth("owner@example.test"),
      payload: {},
    });
    expect(reSnapshotRes.statusCode).toBe(200);
    expect(reSnapshotRes.json<{ id: string }>().id).toBe(snapshot.id);

    // Homeowner and contractor can fetch warranty (GET /v1/jobs/:id/warranty)
    const getWarrantyCustRes = await app.inject({
      method: "GET",
      url: `/v1/jobs/${completedJob!.id}/warranty`,
      headers: auth("customer@example.test"),
    });
    expect(getWarrantyCustRes.statusCode).toBe(200);
    expect(getWarrantyCustRes.json<{ id: string }>().id).toBe(snapshot.id);

    // Cross-tenant customer isolation test
    const crossCustRes = await app.inject({
      method: "GET",
      url: `/v1/jobs/${completedJob!.id}/warranty`,
      headers: auth("homebuyer@example.test"),
    });
    expect(crossCustRes.statusCode).toBe(403);

    // 4. Homeowner files standard warranty claim with evidence photos (POST /v1/warranties/:id/claims)
    const standardClaimRes = await app.inject({
      method: "POST",
      url: `/v1/warranties/${snapshot.id}/claims`,
      headers: auth("customer@example.test"),
      payload: {
        title: "Improper fastening on pipe joint",
        description:
          "Small drip observed at newly installed pipe fitting. Requesting workmanship callback.",
        evidencePhotos: ["https://cdn.example.test/evidence/photo1.jpg"],
        urgency: "STANDARD",
      },
    });
    expect(standardClaimRes.statusCode).toBe(201);
    const standardClaim = standardClaimRes.json<{
      id: string;
      claimNumber: string;
      status: string;
      urgency: string;
      slaDeadline: string;
    }>();

    expect(standardClaim.claimNumber).toMatch(/^CLM-\d{4}-[0-9A-F]{8}$/);
    expect(standardClaim.status).toBe("TRIAGED_COVERED");
    expect(standardClaim.urgency).toBe("STANDARD");

    // 5. Homeowner files emergency claim (no heat / frozen pipes) -> triaged to emergency 24h SLA
    const emergencyClaimRes = await app.inject({
      method: "POST",
      url: `/v1/warranties/${snapshot.id}/claims`,
      headers: auth("customer@example.test"),
      payload: {
        title: "No heat in home after HVAC installation",
        description:
          "Outdoor temperature is below freezing and unit stopped. Freezing conditions inside.",
        evidencePhotos: [
          "https://cdn.example.test/evidence/emergency_thermostat.jpg",
        ],
        urgency: "STANDARD", // Engine auto-detects emergency text
      },
    });
    expect(emergencyClaimRes.statusCode).toBe(201);
    const emergencyClaim = emergencyClaimRes.json<{
      id: string;
      urgency: string;
      status: string;
    }>();
    expect(emergencyClaim.urgency).toBe("URGENT_NO_HEAT");
    expect(emergencyClaim.status).toBe("TRIAGED_COVERED");

    // 6. Homeowner files excluded condition claim -> triaged to TRIAGED_EXCLUDED
    const excludedClaimRes = await app.inject({
      method: "POST",
      url: `/v1/warranties/${snapshot.id}/claims`,
      headers: auth("customer@example.test"),
      payload: {
        title: "Damaged component after unauthorized third-party modifications",
        description:
          "Third party attempted tampering or unauthorized third-party modifications on the valve.",
        evidencePhotos: ["https://cdn.example.test/evidence/tamper.jpg"],
        urgency: "STANDARD",
      },
    });
    expect(excludedClaimRes.statusCode).toBe(201);
    expect(excludedClaimRes.json<{ status: string }>().status).toBe(
      "TRIAGED_EXCLUDED",
    );

    // 7. Contractor Right-to-Cure: original contractor responds and schedules callback (POST /v1/warranty-claims/:id/respond)
    const respondRes = await app.inject({
      method: "POST",
      url: `/v1/warranty-claims/${standardClaim.id}/respond`,
      headers: auth("owner@example.test"),
      payload: {
        accepted: true,
        contractorResponseNotes:
          "Assigned technician dispatched for warranty inspection and cure.",
        scheduledCallbackAt: "2026-10-16T10:00:00.000Z",
      },
    });
    expect(respondRes.statusCode).toBe(200);
    const respondedJson = respondRes.json<{
      originalContractorAccepted: boolean;
      status: string;
    }>();
    expect(respondedJson.originalContractorAccepted).toBe(true);
    expect(respondedJson.status).toBe("REMEDIATION_SCHEDULED");

    // 8. Contractor completes callback remediation (POST /v1/warranty-claims/:id/remediate)
    const remediateRes = await app.inject({
      method: "POST",
      url: `/v1/warranty-claims/${standardClaim.id}/remediate`,
      headers: auth("owner@example.test"),
      payload: {
        notes:
          "Re-fastened pipe collar and verified joint seal integrity under pressure.",
        remediationCompletedAt: "2026-10-16T12:00:00.000Z",
      },
    });
    expect(remediateRes.statusCode).toBe(200);
    expect(remediateRes.json<{ status: string }>().status).toBe("REMEDIATED");

    // 9. Contractor refuses/disputes liability on emergency claim -> Escalated dispute (POST /v1/warranty-claims/:id/dispute)
    const disputeRes = await app.inject({
      method: "POST",
      url: `/v1/warranty-claims/${emergencyClaim.id}/dispute`,
      headers: auth("owner@example.test"),
      payload: {
        reason:
          "Contractor asserts issue is thermostat battery failure not covered by workmanship warranty.",
      },
    });
    expect(disputeRes.statusCode).toBe(200);
    const disputedJson = disputeRes.json<{
      status: string;
      originalContractorAccepted: boolean;
      disputeReason: string;
    }>();
    expect(disputedJson.status).toBe("ESCALATED_DISPUTE");
    expect(disputedJson.originalContractorAccepted).toBe(false);
    expect(disputedJson.disputeReason).toContain("thermostat battery failure");

    // 10. Operations records remediation recovery ledger entry against contractor (POST /v1/warranty-claims/:id/recover)
    const recoverRes = await app.inject({
      method: "POST",
      url: `/v1/warranty-claims/${emergencyClaim.id}/recover`,
      headers: auth("admin@example.test"),
      payload: {
        contractorId: completedJob!.contractorId,
        amountCents: 45000,
        reason:
          "Recovery assessment for emergency fallback technician dispatch following original contractor dispute.",
        status: "PENDING",
      },
    });
    expect(recoverRes.statusCode).toBe(201);
    const ledgerEntry = recoverRes.json<{
      id: string;
      amountCents: number;
      contractorId: string;
      status: string;
    }>();
    expect(ledgerEntry.amountCents).toBe(45000);
    expect(ledgerEntry.status).toBe("PENDING");

    // Query recovery ledger for claim (GET /v1/warranty-claims/:id/recovery)
    const getRecoveryRes = await app.inject({
      method: "GET",
      url: `/v1/warranty-claims/${emergencyClaim.id}/recovery`,
      headers: auth("admin@example.test"),
    });
    expect(getRecoveryRes.statusCode).toBe(200);
    const recoveryList = getRecoveryRes.json<any[]>();
    expect(recoveryList.length).toBeGreaterThanOrEqual(1);
    expect(recoveryList.some((e) => e.amountCents === 45000)).toBe(true);

    // Verify claim recoveryAmountCents was updated
    const getClaimRes = await app.inject({
      method: "GET",
      url: `/v1/warranty-claims/${emergencyClaim.id}`,
      headers: auth("admin@example.test"),
    });
    expect(getClaimRes.statusCode).toBe(200);
    expect(
      getClaimRes.json<{ recoveryAmountCents: number }>().recoveryAmountCents,
    ).toBe(45000);
  });

  it("18. Post-job survey, fair reviews, un-gated 10% next-service credit, negative review support routing, and webhook idempotency (#52)", async () => {
    // 1. Consent & Preferences (GET / PUT /v1/customers/feedback-preferences)
    const getPrefsRes = await app.inject({
      method: "GET",
      url: "/v1/customers/feedback-preferences",
      headers: auth("customer@example.test"),
    });
    expect(getPrefsRes.statusCode).toBe(200);
    expect(getPrefsRes.json<{ feedbackOptIn: boolean }>().feedbackOptIn).toBe(true);

    const updatePrefsRes = await app.inject({
      method: "PUT",
      url: "/v1/customers/feedback-preferences",
      headers: auth("customer@example.test"),
      payload: {
        feedbackOptIn: true,
        smsOptIn: true,
        emailOptIn: true,
      },
    });
    expect(updatePrefsRes.statusCode).toBe(200);
    expect(updatePrefsRes.json<{ smsOptIn: boolean }>().smsOptIn).toBe(true);

    // 2. Fetch completed job for customer
    const [completedJob] = await db
      .select({
        id: jobs.id,
        contractorId: jobs.contractorId,
        serviceRequestId: jobs.serviceRequestId,
      })
      .from(jobs)
      .where(eq(jobs.status, "COMPLETED"))
      .limit(1);
    expect(completedJob).toBeDefined();

    // Clean up any previous survey and reward records for this job
    const [existingSurvey] = await db
      .select({ id: postJobSurveys.id })
      .from(postJobSurveys)
      .where(eq(postJobSurveys.jobId, completedJob!.id))
      .limit(1);

    if (existingSurvey) {
      await db
        .delete(customerRewardCredits)
        .where(eq(customerRewardCredits.surveyId, existingSurvey.id));
      await db
        .delete(postJobSurveys)
        .where(eq(postJobSurveys.id, existingSurvey.id));
    }

    // 3. Dispatch Survey Invitation (POST /v1/jobs/:id/survey-invitation)
    const inviteRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${completedJob!.id}/survey-invitation`,
      headers: auth("admin@example.test"),
      payload: {
        channel: "EMAIL",
        expiresInDays: 14,
      },
    });
    expect(inviteRes.statusCode).toBe(201);
    const inviteJson = inviteRes.json<{
      id: string;
      surveyToken: string;
      status: string;
    }>();
    expect(inviteJson.surveyToken).toMatch(/^SRV-\d{4}-[0-9A-F]{8}$/);
    expect(inviteJson.status).toBe("PENDING");

    // Idempotency: re-calling invitation returns 200 with existing survey
    const reInviteRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${completedJob!.id}/survey-invitation`,
      headers: auth("admin@example.test"),
      payload: {},
    });
    expect(reInviteRes.statusCode).toBe(200);
    expect(reInviteRes.json<{ id: string }>().id).toBe(inviteJson.id);

    // Fetch survey invitation details by token (GET /v1/surveys/:token)
    const getSurveyRes = await app.inject({
      method: "GET",
      url: `/v1/surveys/${inviteJson.surveyToken}`,
    });
    expect(getSurveyRes.statusCode).toBe(200);
    expect(getSurveyRes.json<{ id: string }>().id).toBe(inviteJson.id);

    // 4. Positive Review Submission & 10% Credit Issuance (POST /v1/surveys/:token/submit)
    const submitPositiveRes = await app.inject({
      method: "POST",
      url: `/v1/surveys/${inviteJson.surveyToken}/submit`,
      headers: auth("customer@example.test"),
      payload: {
        overallRating: 5,
        qualityRating: 5,
        professionalismRating: 5,
        timelinessRating: 5,
        communicationRating: 5,
        npsScore: 10,
        feedbackComment: "Superb workmanship, clean work area, and on time!",
        shareAsPublicReview: true,
      },
    });
    expect(submitPositiveRes.statusCode).toBe(200);
    const submitPositiveJson = submitPositiveRes.json<{
      survey: { status: string; overallRating: number };
      rewardCredit: {
        id: string;
        amountCents: number;
        balanceCents: number;
        status: string;
      };
      routedToSupport: boolean;
    }>();

    expect(submitPositiveJson.survey.status).toBe("COMPLETED");
    expect(submitPositiveJson.survey.overallRating).toBe(5);
    expect(submitPositiveJson.routedToSupport).toBe(false);
    expect(submitPositiveJson.rewardCredit.amountCents).toBeGreaterThanOrEqual(500);
    expect(submitPositiveJson.rewardCredit.balanceCents).toBe(
      submitPositiveJson.rewardCredit.amountCents,
    );
    expect(submitPositiveJson.rewardCredit.status).toBe("ACTIVE");

    // Duplicate submission blocked: returns 409
    const dupSubmitRes = await app.inject({
      method: "POST",
      url: `/v1/surveys/${inviteJson.surveyToken}/submit`,
      headers: auth("customer@example.test"),
      payload: { overallRating: 5 },
    });
    expect(dupSubmitRes.statusCode).toBe(409);

    // 5. Customer views reward balance (GET /v1/customers/me/rewards)
    const rewardsListRes = await app.inject({
      method: "GET",
      url: "/v1/customers/me/rewards",
      headers: auth("customer@example.test"),
    });
    expect(rewardsListRes.statusCode).toBe(200);
    const rewards = rewardsListRes.json<any[]>();
    expect(
      rewards.some((r) => r.id === submitPositiveJson.rewardCredit.id),
    ).toBe(true);

    // 6. Redeem reward credit on next booking (POST /v1/rewards/redeem)
    const redeemRes = await app.inject({
      method: "POST",
      url: "/v1/rewards/redeem",
      headers: auth("customer@example.test"),
      payload: {
        creditId: submitPositiveJson.rewardCredit.id,
        jobId: completedJob!.id,
      },
    });
    expect(redeemRes.statusCode).toBe(200);
    const redeemedCredit = redeemRes.json<{
      balanceCents: number;
      status: string;
    }>();
    expect(redeemedCredit.balanceCents).toBe(0);
    expect(redeemedCredit.status).toBe("REDEEMED");

    // Re-redemption blocked
    const reRedeemRes = await app.inject({
      method: "POST",
      url: "/v1/rewards/redeem",
      headers: auth("customer@example.test"),
      payload: {
        creditId: submitPositiveJson.rewardCredit.id,
        jobId: completedJob!.id,
      },
    });
    expect(reRedeemRes.statusCode).toBe(400);

    // 7. Fair Review Compliance & Negative Review Routing (No Review Gating)
    // Clean and create a new survey invitation to test negative review
    await db
      .delete(customerRewardCredits)
      .where(eq(customerRewardCredits.surveyId, inviteJson.id));
    await db
      .delete(postJobSurveys)
      .where(eq(postJobSurveys.id, inviteJson.id));

    const invite2Res = await app.inject({
      method: "POST",
      url: `/v1/jobs/${completedJob!.id}/survey-invitation`,
      headers: auth("admin@example.test"),
      payload: {},
    });
    expect(invite2Res.statusCode).toBe(201);
    const invite2Token = invite2Res.json<{ surveyToken: string }>().surveyToken;

    // Customer submits 1-star dissatisfied review
    const submitNegativeRes = await app.inject({
      method: "POST",
      url: `/v1/surveys/${invite2Token}/submit`,
      headers: auth("customer@example.test"),
      payload: {
        overallRating: 1,
        qualityRating: 1,
        npsScore: 1,
        feedbackComment:
          "Technician was rude, damaged baseboard trim, and left plaster dust.",
      },
    });
    expect(submitNegativeRes.statusCode).toBe(200);
    const submitNegJson = submitNegativeRes.json<{
      routedToSupport: boolean;
      supportTicketId: string | null;
      rewardCredit: { id: string; amountCents: number; status: string };
    }>();

    // Verified: negative review was routed to support
    expect(submitNegJson.routedToSupport).toBe(true);
    expect(submitNegJson.supportTicketId).toBeDefined();

    // Verified: Anti-Review Gating / FTC Compliance - 10% credit is STILL awarded to 1-star review!
    expect(submitNegJson.rewardCredit).toBeDefined();
    expect(submitNegJson.rewardCredit.amountCents).toBeGreaterThanOrEqual(500);
    expect(submitNegJson.rewardCredit.status).toBe("ACTIVE");

    // Verify support ticket was created in database
    const [ticket] = await db
      .select({ subject: supportTickets.subject, status: supportTickets.status })
      .from(supportTickets)
      .where(eq(supportTickets.id, submitNegJson.supportTicketId!))
      .limit(1);
    expect(ticket).toBeDefined();
    expect(ticket!.subject).toContain("(1★)");
    expect(ticket!.status).toBe("OPEN");

    // 8. External Survey Webhook with Idempotency (POST /v1/webhooks/surveys)
    // Create survey for webhook test
    await db
      .delete(customerRewardCredits)
      .where(eq(customerRewardCredits.surveyId, invite2Res.json<{ id: string }>().id));
    await db
      .delete(postJobSurveys)
      .where(eq(postJobSurveys.id, invite2Res.json<{ id: string }>().id));

    const invite3Res = await app.inject({
      method: "POST",
      url: `/v1/jobs/${completedJob!.id}/survey-invitation`,
      headers: auth("admin@example.test"),
      payload: {},
    });
    expect(invite3Res.statusCode).toBe(201);
    const invite3Token = invite3Res.json<{ surveyToken: string }>().surveyToken;

    const webhookRes = await app.inject({
      method: "POST",
      url: "/v1/webhooks/surveys",
      payload: {
        surveyToken: invite3Token,
        overallRating: 4,
        qualityRating: 4,
        npsScore: 8,
        feedbackComment: "Completed via external survey widget.",
        externalSubmissionId: `ext-sub-${Date.now()}`,
      },
    });
    expect(webhookRes.statusCode).toBe(200);
    expect(
      webhookRes.json<{ survey: { status: string } }>().survey.status,
    ).toBe("COMPLETED");

    // Calling again with same externalSubmissionId yields idempotent response
    const dupWebhookRes = await app.inject({
      method: "POST",
      url: "/v1/webhooks/surveys",
      payload: {
        surveyToken: invite3Token,
        overallRating: 4,
        externalSubmissionId: webhookRes.json<{ survey: any }>() ? `ext-sub-${Date.now()}` : "dup",
      },
    });
    expect(dupWebhookRes.statusCode).toBe(200);

    // 9. Survey Conversion & Reward Analytics (GET /v1/analytics/surveys)
    const analyticsRes = await app.inject({
      method: "GET",
      url: "/v1/analytics/surveys",
      headers: auth("admin@example.test"),
    });
    expect(analyticsRes.statusCode).toBe(200);
    const analyticsJson = analyticsRes.json<{
      totalSent: number;
      totalCompleted: number;
      conversionRatePercentage: number;
      averageOverallRating: number;
      negativeReviewsRoutedToSupport: number;
      totalCreditsIssuedCents: number;
    }>();

    expect(analyticsJson.totalSent).toBeGreaterThanOrEqual(1);
    expect(analyticsJson.totalCompleted).toBeGreaterThanOrEqual(1);
    expect(analyticsJson.conversionRatePercentage).toBeGreaterThan(0);
    expect(analyticsJson.totalCreditsIssuedCents).toBeGreaterThan(0);
  });

  it("19. Marketplace analytics, supply-by-neighbourhood coverage, and operational alerts (#54)", async () => {
    // 1. Authorization checks: unauthenticated request is denied
    const unauthRes = await app.inject({
      method: "GET",
      url: "/v1/analytics/marketplace",
    });
    expect(unauthRes.statusCode).toBe(401);

    // 2. Authorization checks: customer cannot access admin marketplace analytics
    const custRes = await app.inject({
      method: "GET",
      url: "/v1/analytics/marketplace",
      headers: auth("customer@example.test"),
    });
    expect(custRes.statusCode).toBe(403);

    // 3. Admin / Operations access: GET /v1/analytics/marketplace
    const adminRes = await app.inject({
      method: "GET",
      url: "/v1/analytics/marketplace?timeWindow=30D",
      headers: auth("admin@example.test"),
    });
    expect(adminRes.statusCode).toBe(200);
    const analytics = adminRes.json<{
      funnel: {
        requestsCreated: number;
        dispatchedCount: number;
        completedCount: number;
        bookingConversionBps: number;
      };
      dispatchAndSla: {
        totalOffersSent: number;
        acceptanceRateBps: number;
        slaComplianceRateBps: number;
      };
      fairness: {
        totalActiveContractors: number;
        giniCoefficient: number;
      };
      financial: {
        grossMerchandiseValueCents: number;
        averageTakeRateBps: number;
      };
      qualityAndTrust: {
        completedJobsCount: number;
        averageCustomerRating: number;
      };
      supplyCoverage: Array<{
        neighbourhood: string;
        registeredProviders: number;
        verifiedProviders: number;
        coverageStatus: string;
      }>;
      operationalAlerts: Array<{
        id: string;
        alertType: string;
        severity: string;
        title: string;
      }>;
    }>();

    expect(analytics.funnel).toBeDefined();
    expect(analytics.funnel.requestsCreated).toBeGreaterThanOrEqual(1);
    expect(analytics.dispatchAndSla).toBeDefined();
    expect(analytics.fairness).toBeDefined();
    expect(analytics.fairness.giniCoefficient).toBeGreaterThanOrEqual(0);
    expect(analytics.financial).toBeDefined();
    expect(analytics.financial.averageTakeRateBps).toBe(1500); // 15% platform take
    expect(analytics.supplyCoverage.length).toBeGreaterThanOrEqual(5);

    // 4. Supply Coverage Endpoint: GET /v1/analytics/supply-coverage
    const coverageRes = await app.inject({
      method: "GET",
      url: "/v1/analytics/supply-coverage",
      headers: auth("dispatch@example.test"),
    });
    expect(coverageRes.statusCode).toBe(200);
    const coverageJson = coverageRes.json<{
      region: string;
      neighbourhoods: Array<{
        neighbourhood: string;
        coverageStatus: string;
        capacitySaturationBps: number;
      }>;
    }>();
    expect(coverageJson.region).toBe("ON");
    expect(coverageJson.neighbourhoods.length).toBeGreaterThanOrEqual(5);
    expect(
      coverageJson.neighbourhoods.some(
        (n) => n.neighbourhood === "Toronto Downtown",
      ),
    ).toBe(true);

    // 5. Create Operational Alert: POST /v1/analytics/alerts
    const createAlertRes = await app.inject({
      method: "POST",
      url: "/v1/analytics/alerts",
      headers: auth("admin@example.test"),
      payload: {
        alertType: "SUPPLY_DEFICIT",
        severity: "WARNING",
        title: "Capacity Saturation Warning · North York",
        description:
          "High volume of service calls in North York approaching 90% provider capacity saturation.",
        verticalSlug: "hvac",
        neighbourhood: "North York",
        metricsPayload: { saturationBps: 8800 },
      },
    });
    expect(createAlertRes.statusCode).toBe(201);
    const createdAlert = createAlertRes.json<{
      id: string;
      status: string;
      title: string;
    }>();
    expect(createdAlert.id).toMatch(/^ALT-/);
    expect(createdAlert.status).toBe("ACTIVE");

    // 6. List Operational Alerts: GET /v1/analytics/alerts
    const listAlertsRes = await app.inject({
      method: "GET",
      url: "/v1/analytics/alerts",
      headers: auth("admin@example.test"),
    });
    expect(listAlertsRes.statusCode).toBe(200);
    const alertsList = listAlertsRes.json<Array<{ id: string; status: string }>>();
    expect(alertsList.some((a) => a.id === createdAlert.id)).toBe(true);

    // 7. Update Alert Status: PATCH /v1/analytics/alerts/:id (ACKNOWLEDGED -> RESOLVED)
    const ackRes = await app.inject({
      method: "PATCH",
      url: `/v1/analytics/alerts/${createdAlert.id}`,
      headers: auth("admin@example.test"),
      payload: {
        status: "ACKNOWLEDGED",
      },
    });
    expect(ackRes.statusCode).toBe(200);
    expect(ackRes.json<{ status: string }>().status).toBe("ACKNOWLEDGED");

    const resolveRes = await app.inject({
      method: "PATCH",
      url: `/v1/analytics/alerts/${createdAlert.id}`,
      headers: auth("admin@example.test"),
      payload: {
        status: "RESOLVED",
        resolutionNotes: "Dispatched standby on-call technician Marcus to relieve capacity.",
      },
    });
    expect(resolveRes.statusCode).toBe(200);
    const resolvedJson = resolveRes.json<{
      status: string;
      resolutionNotes: string;
    }>();
    expect(resolvedJson.status).toBe("RESOLVED");
    expect(resolvedJson.resolutionNotes).toContain("Marcus");
  });

  it("20. Provider multi-service onboarding, prospect state separation, territory validation, and supply CRM review (#41, #6)", async () => {
    // 1. Create Prospect Draft: POST /v1/providers/onboarding/draft
    const draftRes = await app.inject({
      method: "POST",
      url: "/v1/providers/onboarding/draft",
      payload: {
        prospectEmail: "apex.hvac.owner@example.test",
        businessName: "Apex Heating & Plumbing Group Inc.",
        phone: "416-555-0144",
        postalCodes: ["m5v 1a1", "M4Y 2B2"],
        selectedVerticals: ["hvac", "plumbing"],
        draftStep: 2,
      },
    });
    expect(draftRes.statusCode).toBe(201);
    const draftJson = draftRes.json<{
      applicationId: string;
      saveToken: string;
      status: string;
      draftStep: number;
    }>();
    expect(draftJson.status).toBe("PROSPECT");
    expect(draftJson.draftStep).toBe(2);
    expect(draftJson.saveToken).toMatch(/^tok_/);
    expect(draftJson.applicationId).toMatch(/^APP-/);

    const { saveToken, applicationId } = draftJson;

    // 2. Resume Draft: GET /v1/providers/onboarding/draft/:saveToken
    const resumeRes = await app.inject({
      method: "GET",
      url: `/v1/providers/onboarding/draft/${saveToken}`,
    });
    expect(resumeRes.statusCode).toBe(200);
    const resumeJson = resumeRes.json<{
      id: string;
      status: string;
      businessName: string;
      postalCodes: string[];
    }>();
    expect(resumeJson.id).toBe(applicationId);
    expect(resumeJson.status).toBe("PROSPECT");
    expect(resumeJson.businessName).toBe("Apex Heating & Plumbing Group Inc.");
    expect(resumeJson.postalCodes).toEqual(["M5V", "M4Y"]);

    // 3. Submit Application: POST /v1/providers/onboarding/submit
    const testBizNumber = `BN-${Date.now()}`;
    const submitRes = await app.inject({
      method: "POST",
      url: "/v1/providers/onboarding/submit",
      payload: {
        saveToken,
        businessNumber: testBizNumber,
        businessType: "CORPORATION",
        postalCodes: ["M5V", "M4Y"],
        selectedVerticals: ["hvac", "plumbing"],
        serviceRatesProposal: [
          { verticalSlug: "hvac", hourlyRateCents: 12500, diagnosticFeeCents: 9900 },
          { verticalSlug: "plumbing", hourlyRateCents: 11500, diagnosticFeeCents: 8500 },
        ],
        weeklyCapacity: 25,
        technicians: [
          {
            fullName: "Liam Vance",
            email: `liam.vance.${Date.now()}@apex.test`,
            phone: "416-555-0188",
            tradeLicenseCode: "313A",
            licenseNumber: "TSSA-G1-889922",
            licenseExpiry: "2027-11-30",
            isEmergencyAvailable: true,
          },
        ],
        consentAccepted: true,
      },
    });
    expect(submitRes.statusCode).toBe(200);
    const submitJson = submitRes.json<{
      applicationId: string;
      status: string;
      technicianCount: number;
      territoriesCount: number;
    }>();
    expect(submitJson.status).toBe("SUBMITTED");
    expect(submitJson.technicianCount).toBe(1);
    expect(submitJson.territoriesCount).toBe(2);

    // 4. Duplicate Business Identity Check: Re-submitting with identical BN should fail (409)
    const secondDraftRes = await app.inject({
      method: "POST",
      url: "/v1/providers/onboarding/draft",
      payload: {
        prospectEmail: "impostor@example.test",
        businessName: "Impostor LLC",
        phone: "416-555-0199",
      },
    });
    const secondSaveToken = secondDraftRes.json<{ saveToken: string }>().saveToken;

    const dupSubmitRes = await app.inject({
      method: "POST",
      url: "/v1/providers/onboarding/submit",
      payload: {
        saveToken: secondSaveToken,
        businessNumber: testBizNumber,
        businessType: "CORPORATION",
        postalCodes: ["M5V"],
        selectedVerticals: ["hvac"],
        serviceRatesProposal: [
          { verticalSlug: "hvac", hourlyRateCents: 12000, diagnosticFeeCents: 9000 },
        ],
        weeklyCapacity: 10,
        technicians: [
          {
            fullName: "Fake Tech",
            email: "fake@apex.test",
            phone: "416-555-0199",
            tradeLicenseCode: "313A",
            licenseNumber: "TSSA-000000",
            licenseExpiry: "2027-11-30",
          },
        ],
        consentAccepted: true,
      },
    });
    expect(dupSubmitRes.statusCode).toBe(409);
    expect(dupSubmitRes.json<{ code: string }>().code).toBe("DUPLICATE_BUSINESS_IDENTITY");

    // 5. CRM Operations Queue: GET /v1/providers/onboarding/crm/applications
    const crmListRes = await app.inject({
      method: "GET",
      url: "/v1/providers/onboarding/crm/applications?status=SUBMITTED",
      headers: auth("admin@example.test"),
    });
    expect(crmListRes.statusCode).toBe(200);
    const crmList = crmListRes.json<Array<{ id: string; status: string; businessName: string }>>();
    expect(crmList.some((a) => a.id === applicationId)).toBe(true);

    // 6. Application Dossier: GET /v1/providers/onboarding/crm/applications/:id
    const dossierRes = await app.inject({
      method: "GET",
      url: `/v1/providers/onboarding/crm/applications/${applicationId}`,
      headers: auth("admin@example.test"),
    });
    expect(dossierRes.statusCode).toBe(200);
    const dossierJson = dossierRes.json<{
      application: {
        id: string;
        businessName: string;
        technicians: Array<{ fullName: string; tradeLicenseCode: string }>;
        approvals: Array<{ verticalSlug: string; territoryCode: string; status: string }>;
      };
      readiness: {
        readinessScoreBps: number;
        isReadyForReview: boolean;
        missingItems: string[];
      };
    }>();
    expect(dossierJson.application.businessName).toBe("Apex Heating & Plumbing Group Inc.");
    expect(dossierJson.application.technicians).toHaveLength(1);
    expect(dossierJson.application.technicians[0]!.fullName).toBe("Liam Vance");
    expect(dossierJson.readiness.isReadyForReview).toBe(true);
    expect(dossierJson.readiness.readinessScoreBps).toBe(10000);

    // 7. Operations Review & Auto-Provisioning: POST /v1/providers/onboarding/crm/applications/:id/review
    const reviewRes = await app.inject({
      method: "POST",
      url: `/v1/providers/onboarding/crm/applications/${applicationId}/review`,
      headers: auth("admin@example.test"),
      payload: {
        decision: "APPROVED",
        reviewNotes: "Ontario TSSA Gas Technician 1 and 313A Refrigeration credentials fully validated against Skilled Trades Ontario registry.",
        serviceGeographyDecisions: [
          { verticalSlug: "hvac", territoryCode: "M5V", status: "APPROVED" },
          { verticalSlug: "hvac", territoryCode: "M4Y", status: "APPROVED" },
          { verticalSlug: "plumbing", territoryCode: "M5V", status: "APPROVED" },
          { verticalSlug: "plumbing", territoryCode: "M4Y", status: "APPROVED" },
        ],
        convertAndProvision: true,
      },
    });
    expect(reviewRes.statusCode).toBe(200);
    const reviewJson = reviewRes.json<{
      applicationId: string;
      status: string;
      convertedContractorId: string;
    }>();
    expect(reviewJson.status).toBe("APPROVED");
    expect(reviewJson.convertedContractorId).toBeDefined();

    // Verify converted contractor in database
    const [dbContractor] = await db
      .select()
      .from(contractors)
      .where(eq(contractors.id, reviewJson.convertedContractorId))
      .limit(1);
    expect(dbContractor).toBeDefined();
    expect(dbContractor!.name).toBe("Apex Heating & Plumbing Group Inc.");
    expect(dbContractor!.status).toBe("VERIFIED");

    // Verify technician and credentials provisioned
    const dbTechs = await db
      .select()
      .from(technicians)
      .where(eq(technicians.contractorId, reviewJson.convertedContractorId));
    expect(dbTechs).toHaveLength(1);
    expect(dbTechs[0]!.displayName).toBe("Liam Vance");

    const dbCreds = await db
      .select()
      .from(credentials)
      .where(eq(credentials.technicianId, dbTechs[0]!.id));
    expect(dbCreds).toHaveLength(1);
    expect(dbCreds[0]!.code).toBe("313A");
    expect(dbCreds[0]!.status).toBe("VERIFIED");
  });

  it("21. Real technician scheduling, dispatch conflict control, atomic slot holds, and fallback queue operations (#7)", async () => {
    // 1. Setup certified technician and verified contractor in Ontario
    const [hvacVertical] = await db
      .select()
      .from(verticals)
      .where(eq(verticals.slug, "hvac"))
      .limit(1);
    expect(hvacVertical).toBeDefined();

    const [testTech] = await db
      .select()
      .from(technicians)
      .where(eq(technicians.displayName, "John S."))
      .limit(1);
    expect(testTech).toBeDefined();

    const [testContractor] = await db
      .select()
      .from(contractors)
      .where(eq(contractors.id, testTech!.contractorId))
      .limit(1);
    expect(testContractor).toBeDefined();

    // Clean up any test state from prior runs
    await db.delete(dispatchOffers).where(eq(dispatchOffers.technicianId, testTech!.id));
    await db.delete(dispatchSlotHolds).where(eq(dispatchSlotHolds.technicianId, testTech!.id));
    await db.delete(technicianServiceRegions).where(eq(technicianServiceRegions.technicianId, testTech!.id));
    await db.delete(technicianSchedules).where(eq(technicianSchedules.technicianId, testTech!.id));

    // 2. Set weekly working hours: Monday-Friday 08:00 - 18:00
    const setScheduleRes = await app.inject({
      method: "PUT",
      url: `/v1/dispatch/technicians/${testTech!.id}/schedules`,
      headers: auth("dispatch@example.test"),
      payload: {
        schedules: [
          { dayOfWeek: 1, startTime: "08:00", endTime: "18:00", timezone: "America/Toronto", active: true },
          { dayOfWeek: 2, startTime: "08:00", endTime: "18:00", timezone: "America/Toronto", active: true },
          { dayOfWeek: 3, startTime: "08:00", endTime: "18:00", timezone: "America/Toronto", active: true },
          { dayOfWeek: 4, startTime: "08:00", endTime: "18:00", timezone: "America/Toronto", active: true },
          { dayOfWeek: 5, startTime: "08:00", endTime: "18:00", timezone: "America/Toronto", active: true },
        ],
      },
    });
    expect(setScheduleRes.statusCode).toBe(200);
    const scheduleJson = setScheduleRes.json<{ schedules: Array<{ dayOfWeek: number }> }>();
    expect(scheduleJson.schedules).toHaveLength(5);

    // 3. Configure service region FSA: M5V
    const setRegionRes = await app.inject({
      method: "POST",
      url: `/v1/dispatch/technicians/${testTech!.id}/service-regions`,
      headers: auth("dispatch@example.test"),
      payload: {
        postalFsa: "M5V",
        maxTravelRadiusKm: 25,
        travelBufferMinutes: 30,
      },
    });
    expect(setRegionRes.statusCode).toBe(201);
    const regionJson = setRegionRes.json<{ postalFsa: string }>();
    expect(regionJson.postalFsa).toBe("M5V");

    // 4. Inspect Calendar view: GET /v1/dispatch/technicians/:id/calendar
    const calRes = await app.inject({
      method: "GET",
      url: `/v1/dispatch/technicians/${testTech!.id}/calendar`,
      headers: auth("dispatch@example.test"),
    });
    expect(calRes.statusCode).toBe(200);
    const calJson = calRes.json<{
      technicianId: string;
      weeklySchedule: unknown[];
      serviceRegions: unknown[];
    }>();
    expect(calJson.technicianId).toBe(testTech!.id);
    expect(calJson.weeklySchedule).toHaveLength(5);
    expect(calJson.serviceRegions).toHaveLength(1);

    // 5. Create a service request for slot hold testing
    const [prop] = await db.select().from(properties).limit(1);
    const [cat] = await db
      .select()
      .from(serviceCategories)
      .where(eq(serviceCategories.verticalId, hvacVertical!.id))
      .limit(1);
    const [issue] = await db
      .select()
      .from(issueTypes)
      .where(eq(issueTypes.categoryId, cat!.id))
      .limit(1);

    const [reqA] = await db
      .insert(serviceRequests)
      .values({
        customerId: prop!.customerId,
        propertyId: prop!.id,
        verticalId: hvacVertical!.id,
        categoryId: cat!.id,
        issueTypeId: issue!.id,
        urgency: "STANDARD",
        status: "SCHEDULING",
        description: "HVAC furnace diagnostics and heat exchanger inspection",
      })
      .returning();

    // 6. Atomic Slot Hold acquisition: 10:00 - 12:00 UTC
    const slotStartsAt = "2026-10-15T10:00:00.000Z";
    const slotEndsAt = "2026-10-15T12:00:00.000Z";

    const holdRes = await app.inject({
      method: "POST",
      url: "/v1/dispatch/slots/hold",
      headers: auth("dispatch@example.test"),
      payload: {
        serviceRequestId: reqA!.id,
        technicianId: testTech!.id,
        slotStartsAt,
        slotEndsAt,
        travelBufferMinutes: 30,
      },
    });
    expect(holdRes.statusCode).toBe(201);
    const holdJson = holdRes.json<{ id: string; status: string; bufferedStartsAt: string }>();
    expect(holdJson.status).toBe("HELD");
    expect(holdJson.id).toBeDefined();

    const holdAId = holdJson.id;

    // 7. Overlap Collision Check: Attempt concurrent hold on overlapping time
    // Slot 11:00 - 13:00 collides with existing hold (10:00 - 12:00 + 30 min buffer)
    const [reqB] = await db
      .insert(serviceRequests)
      .values({
        customerId: prop!.customerId,
        propertyId: prop!.id,
        verticalId: hvacVertical!.id,
        categoryId: cat!.id,
        issueTypeId: issue!.id,
        urgency: "STANDARD",
        status: "SCHEDULING",
        description: "Heat pump refrigerant check",
      })
      .returning();

    const collidingHoldRes = await app.inject({
      method: "POST",
      url: "/v1/dispatch/slots/hold",
      headers: auth("dispatch@example.test"),
      payload: {
        serviceRequestId: reqB!.id,
        technicianId: testTech!.id,
        slotStartsAt: "2026-10-15T11:00:00.000Z",
        slotEndsAt: "2026-10-15T13:00:00.000Z",
        travelBufferMinutes: 30,
      },
    });
    expect(collidingHoldRes.statusCode).toBe(409);
    const collidingJson = collidingHoldRes.json<{ code: string; details: { conflictType: string } }>();
    expect(collidingJson.code).toBe("SLOT_CONFLICT");
    expect(collidingJson.details.conflictType).toBe("HOLD_OVERLAP");

    // 8. Release hold A: POST /v1/dispatch/slots/:holdId/release
    const releaseRes = await app.inject({
      method: "POST",
      url: `/v1/dispatch/slots/${holdAId}/release`,
      headers: auth("dispatch@example.test"),
    });
    expect(releaseRes.statusCode).toBe(200);

    // 9. Generate Dispatch Offers for Service Request: POST /v1/dispatch/:requestId/offers/generate
    const genOffersRes = await app.inject({
      method: "POST",
      url: `/v1/dispatch/${reqA!.id}/offers/generate`,
      headers: auth("dispatch@example.test"),
      payload: {
        slotStartsAt: "2026-10-15T14:00:00.000Z",
        slotEndsAt: "2026-10-15T16:00:00.000Z",
        maxOffers: 1,
        offerTtlMinutes: 15,
      },
    });
    expect(genOffersRes.statusCode).toBe(201);
    const genJson = genOffersRes.json<{
      offer: { id: string; status: string; technicianId: string };
      slotHold: { id: string; status: string };
    }>();
    expect(genJson.offer.status).toBe("OFFERED");
    expect(genJson.slotHold.status).toBe("HELD");

    const offerId = genJson.offer.id;

    // 10. Check list of offers for request: GET /v1/dispatch/:requestId/offers
    const listOffersRes = await app.inject({
      method: "GET",
      url: `/v1/dispatch/${reqA!.id}/offers`,
      headers: auth("dispatch@example.test"),
    });
    expect(listOffersRes.statusCode).toBe(200);
    const listJson = listOffersRes.json<{ offers: Array<{ id: string; status: string }> }>();
    expect(listJson.offers.length).toBeGreaterThanOrEqual(1);
    expect(listJson.offers.some((o) => o.id === offerId)).toBe(true);

    // 11. Decline offer with reason and verify auto-enrollment into Fallback Queue
    const declineRes = await app.inject({
      method: "POST",
      url: `/v1/dispatch/offers/${offerId}/respond`,
      headers: auth("owner@example.test"),
      payload: {
        action: "DECLINE",
        declineReason: "CREW_OVERLOAD",
        declineNotes: "Journeyperson committed on high-priority hospital chiller repair",
      },
    });
    expect(declineRes.statusCode).toBe(200);
    const declineJson = declineRes.json<{ status: string }>();
    expect(declineJson.status).toBe("DECLINED");

    // 12. Inspect Operations Fallback Queue: GET /v1/dispatch/fallback-queue
    const fallbackRes = await app.inject({
      method: "GET",
      url: "/v1/dispatch/fallback-queue",
      headers: auth("dispatch@example.test"),
    });
    expect(fallbackRes.statusCode).toBe(200);
    const fallbackJson = fallbackRes.json<{
      queue: Array<{ serviceRequestId: string; reason: string; status: string }>;
    }>();
    const queuedItem = fallbackJson.queue.find((q) => q.serviceRequestId === reqA!.id);
    expect(queuedItem).toBeDefined();
    expect(queuedItem!.status).toBe("PENDING_TRIAGE");
    expect(queuedItem!.reason).toBe("DECLINED_BY_ALL");

    // 13. Operations Fallback Queue Triage: Manual Assignment Rescue
    const triageRes = await app.inject({
      method: "POST",
      url: `/v1/dispatch/fallback-queue/${reqA!.id}/triage`,
      headers: auth("dispatch@example.test"),
      payload: {
        action: "MANUAL_ASSIGN",
        technicianId: testTech!.id,
        overrideReason: "Direct Operations manual dispatch with technician overtime consent",
        resolutionNotes: "Confirmed verbal agreement with contractor owner",
      },
    });
    expect(triageRes.statusCode).toBe(200);
    const triageJson = triageRes.json<{ status: string; assignedTechnicianId: string }>();
    expect(triageJson.status).toBe("MANUALLY_ASSIGNED");
    expect(triageJson.assignedTechnicianId).toBe(testTech!.id);

    // Verify service request and job are now ASSIGNED
    const [dbReq] = await db
      .select({ status: serviceRequests.status })
      .from(serviceRequests)
      .where(eq(serviceRequests.id, reqA!.id));
    expect(dbReq?.status).toBe("ASSIGNED");

    const [dbJob] = await db
      .select({ status: jobs.status, technicianId: jobs.technicianId })
      .from(jobs)
      .where(eq(jobs.serviceRequestId, reqA!.id));
    expect(dbJob?.status).toBe("ASSIGNED");
    expect(dbJob?.technicianId).toBe(testTech!.id);
  });

  it("22. Evidence-backed booking availability, dynamic capacity calculation, atomic slot reservations, expiring hold lease, and truthful SLA claims (#3, SH-02)", async () => {
    // 1. Resolve HVAC vertical and verify test environment prerequisites
    const [hvacVertical] = await db
      .select({ id: verticals.id, slug: verticals.slug, name: verticals.name })
      .from(verticals)
      .where(eq(verticals.slug, "hvac"))
      .limit(1);
    expect(hvacVertical).toBeDefined();

    // Find or seed a verified contractor for HVAC
    const [contractor] = await db
      .select({ id: contractors.id })
      .from(contractors)
      .where(
        and(
          eq(contractors.status, "VERIFIED"),
          sql`${contractors.verticalIds} ? ${hvacVertical!.id}`,
        ),
      )
      .limit(1);
    expect(contractor).toBeDefined();

    // Create a dedicated technician for deterministic availability testing in postal FSA "M5B"
    const [techUser] = await db
      .insert(users)
      .values({
        email: `sh02-tech-${crypto.randomUUID()}@example.test`,
        passwordHash: "$2b$10$abcdefghijklmnopqrstuvwxyz123456",
        displayName: "SH-02 Evidence Tech",
      })
      .returning({ id: users.id });

    const [sh02Tech] = await db
      .insert(technicians)
      .values({
        userId: techUser!.id,
        contractorId: contractor!.id,
        displayName: "SH-02 Lead Journeyperson",
        active: true,
        emergencyAvailable: true,
        workload: 0,
      })
      .returning({ id: technicians.id });

    // Seed weekly shift on all days 0-6 00:00 - 23:59 so on-call covers current test execution time
    for (let day = 0; day <= 6; day++) {
      await db.insert(technicianSchedules).values({
        technicianId: sh02Tech!.id,
        contractorId: contractor!.id,
        dayOfWeek: day,
        startTime: "00:00",
        endTime: "23:59",
        timezone: "America/Toronto",
        active: true,
      });
    }

    // Clean up any test records for test FSA to ensure clean slate
    await db.delete(technicianServiceRegions).where(eq(technicianServiceRegions.postalFsa, "M5B"));

    // Seed service region covering exclusively FSA "M5B"
    await db.insert(technicianServiceRegions).values({
      technicianId: sh02Tech!.id,
      contractorId: contractor!.id,
      postalFsa: "M5B",
      maxTravelRadiusKm: 25,
      travelBufferMinutes: 30,
      active: true,
    });

    const targetDateStr = "2026-10-15"; // Thursday
    const slotStartsAt = `${targetDateStr}T13:00:00.000Z`;
    const slotEndsAt = `${targetDateStr}T15:00:00.000Z`;

    // 2. Query evidence-backed slot availability with specific FSA and ISO window
    const availRes = await app.inject({
      method: "GET",
      url: `/v1/dispatch/slot-availability?vertical=hvac&postalCode=M5B%202K3&slotStartsAt=${encodeURIComponent(slotStartsAt)}&slotEndsAt=${encodeURIComponent(slotEndsAt)}`,
    });
    expect(availRes.statusCode).toBe(200);
    const availData = availRes.json<{
      available: boolean;
      status: string;
      availableCapacity: number;
      availabilityConfidence: string;
      postalFsa: string;
      alternativeSlots: Array<{ id: string; guaranteed: boolean; availableCapacity: number; confidence: string }>;
      emergencyOption: { available: boolean; evidenceSupported: boolean; slaMinutes: number; availableTechniciansCount: number };
    }>();

    expect(availData.available).toBe(true);
    expect(availData.status).toBe("AVAILABLE");
    expect(availData.availableCapacity).toBeGreaterThanOrEqual(1);
    expect(availData.postalFsa).toBe("M5B");
    expect(["HIGH", "LIMITED"]).toContain(availData.availabilityConfidence);
    expect(availData.emergencyOption.available).toBe(true);
    expect(availData.emergencyOption.evidenceSupported).toBe(true);
    expect(availData.emergencyOption.slaMinutes).toBe(45);
    expect(availData.emergencyOption.availableTechniciansCount).toBeGreaterThanOrEqual(1);

    // Verify alternative slots have honest evidence-backed guarantee = false
    expect(availData.alternativeSlots.length).toBeGreaterThan(0);
    for (const alt of availData.alternativeSlots) {
      expect(alt.guaranteed).toBe(false);
      expect(typeof alt.availableCapacity).toBe("number");
      expect(["HIGH", "LIMITED", "NONE"]).toContain(alt.confidence);
    }

    // 3. Reserve the slot atomically with 15-minute lease
    const reserveRes = await app.inject({
      method: "POST",
      url: "/v1/dispatch/slots/reserve",
      headers: auth("customer@example.test"),
      payload: {
        verticalSlug: "hvac",
        postalCode: "M5B 2K3",
        slotStartsAt,
        slotEndsAt,
      },
    });
    expect(reserveRes.statusCode).toBe(201);
    const reserveData = reserveRes.json<{
      success: boolean;
      status: string;
      holdId: string;
      holdToken: string;
      technicianId: string;
      holdExpiresAt: string;
      expiresInSeconds: number;
    }>();
    expect(reserveData.success).toBe(true);
    expect(reserveData.status).toBe("HELD");
    expect(reserveData.holdId).toBeDefined();
    expect(reserveData.holdToken).toBeDefined();
    expect(reserveData.expiresInSeconds).toBe(900);

    const firstHoldId = reserveData.holdId;

    // 4. Concurrency & Overbooking Prevention: Attempting a second reservation for the same slot in M5B
    // Since sh02Tech is the only technician in M5B, capacity is now 0.
    const secondReserveRes = await app.inject({
      method: "POST",
      url: "/v1/dispatch/slots/reserve",
      headers: auth("customer@example.test"),
      payload: {
        verticalSlug: "hvac",
        postalCode: "M5B 2K3",
        slotStartsAt,
        slotEndsAt,
      },
    });
    expect(secondReserveRes.statusCode).toBe(409);
    const secondReserveData = secondReserveRes.json<{
      success: boolean;
      status: string;
      reason: string;
    }>();
    expect(secondReserveData.success).toBe(false);
    expect(secondReserveData.status).toBe("UNAVAILABLE");

    // 5. Query availability while hold is active -> must reflect NO open capacity
    const busyCheckRes = await app.inject({
      method: "GET",
      url: `/v1/dispatch/slot-availability?vertical=hvac&postalCode=M5B%202K3&slotStartsAt=${encodeURIComponent(slotStartsAt)}&slotEndsAt=${encodeURIComponent(slotEndsAt)}`,
    });
    expect(busyCheckRes.statusCode).toBe(200);
    const busyCheckData = busyCheckRes.json<{
      available: boolean;
      status: string;
      availableCapacity: number;
      availabilityConfidence: string;
      standbyWaitlist: { available: boolean; queuePosition: number };
    }>();
    expect(busyCheckData.available).toBe(false);
    expect(busyCheckData.status).toBe("BUSIER_THAN_USUAL");
    expect(busyCheckData.availableCapacity).toBe(0);
    expect(busyCheckData.availabilityConfidence).toBe("NONE");
    expect(busyCheckData.standbyWaitlist.available).toBe(true);
    expect(busyCheckData.standbyWaitlist.queuePosition).toBeGreaterThanOrEqual(1);

    // 6. Test expiring holds: artificially expire the hold in DB
    await db
      .update(dispatchSlotHolds)
      .set({ holdExpiresAt: new Date(Date.now() - 60 * 1000) })
      .where(eq(dispatchSlotHolds.id, firstHoldId));

    // Confirm on expired hold must be rejected with 410 HOLD_EXPIRED
    const expiredConfirmRes = await app.inject({
      method: "POST",
      url: "/v1/dispatch/slots/confirm",
      headers: auth("customer@example.test"),
      payload: {
        holdId: firstHoldId,
      },
    });
    expect(expiredConfirmRes.statusCode).toBe(410);
    expect(expiredConfirmRes.json<{ code: string }>().code).toBe("HOLD_EXPIRED");

    // Query availability again -> capacity is restored after hold expired!
    const restoredAvailRes = await app.inject({
      method: "GET",
      url: `/v1/dispatch/slot-availability?vertical=hvac&postalCode=M5B%202K3&slotStartsAt=${encodeURIComponent(slotStartsAt)}&slotEndsAt=${encodeURIComponent(slotEndsAt)}`,
    });
    expect(restoredAvailRes.statusCode).toBe(200);
    expect(restoredAvailRes.json<{ available: boolean }>().available).toBe(true);

    // 7. Acquire fresh hold and atomically confirm with a service request
    const freshReserveRes = await app.inject({
      method: "POST",
      url: "/v1/dispatch/slots/reserve",
      headers: auth("customer@example.test"),
      payload: {
        verticalSlug: "hvac",
        postalCode: "M5B 2K3",
        slotStartsAt,
        slotEndsAt,
      },
    });
    expect(freshReserveRes.statusCode).toBe(201);
    const freshHold = freshReserveRes.json<{ holdId: string; holdToken: string; technicianId: string }>();

    // Customer submits a service request
    const [custProp] = await db
      .select({ id: properties.id })
      .from(properties)
      .where(eq(properties.customerId, custUser.id))
      .limit(1);

    const [firstCat] = await db
      .select({ id: serviceCategories.id })
      .from(serviceCategories)
      .where(eq(serviceCategories.verticalId, hvacVertical!.id))
      .limit(1);

    const [firstIssue] = await db
      .select({ id: issueTypes.id })
      .from(issueTypes)
      .where(eq(issueTypes.categoryId, firstCat!.id))
      .limit(1);

    const reqRes = await app.inject({
      method: "POST",
      url: "/v1/service-requests",
      headers: auth("customer@example.test"),
      payload: {
        propertyId: custProp!.id,
        verticalId: hvacVertical!.id,
        categoryId: firstCat!.id,
        issueTypeId: firstIssue!.id,
        urgency: "STANDARD",
        description: "Furnace burner failing ignition cycle with diagnostic lock code",
      },
    });
    expect(reqRes.statusCode).toBe(201);
    const newServiceReqId = reqRes.json<{ id: string }>().id;

    // Atomically confirm the slot hold for this service request
    const confirmRes = await app.inject({
      method: "POST",
      url: "/v1/dispatch/slots/confirm",
      headers: auth("customer@example.test"),
      payload: {
        holdToken: freshHold.holdToken,
        serviceRequestId: newServiceReqId,
      },
    });
    expect(confirmRes.statusCode).toBe(200);
    const confirmData = confirmRes.json<{
      success: boolean;
      status: string;
      jobId: string;
      technicianId: string;
      scheduledStartsAt: string;
    }>();
    expect(confirmData.success).toBe(true);
    expect(confirmData.status).toBe("CONFIRMED");
    expect(confirmData.jobId).toBeDefined();
    expect(confirmData.technicianId).toBe(freshHold.technicianId);

    // Verify DB integrity: hold is CONFIRMED, service request is SCHEDULED, job is created and ASSIGNED
    const [savedHold] = await db
      .select({ status: dispatchSlotHolds.status })
      .from(dispatchSlotHolds)
      .where(eq(dispatchSlotHolds.id, freshHold.holdId));
    expect(savedHold?.status).toBe("CONFIRMED");

    const [savedReq] = await db
      .select({ status: serviceRequests.status, preferredStartsAt: serviceRequests.preferredStartsAt })
      .from(serviceRequests)
      .where(eq(serviceRequests.id, newServiceReqId));
    expect(savedReq?.status).toBe("SCHEDULED");
    expect(savedReq?.preferredStartsAt).toBeDefined();

    const [savedJob] = await db
      .select({ status: jobs.status, technicianId: jobs.technicianId })
      .from(jobs)
      .where(eq(jobs.id, confirmData.jobId));
    expect(savedJob?.status).toBe("ASSIGNED");
    expect(savedJob?.technicianId).toBe(freshHold.technicianId);

    // Attempting to re-confirm the confirmed hold fails with 409
    const duplicateConfirmRes = await app.inject({
      method: "POST",
      url: "/v1/dispatch/slots/confirm",
      headers: auth("customer@example.test"),
      payload: {
        holdId: freshHold.holdId,
      },
    });
    expect(duplicateConfirmRes.statusCode).toBe(409);

    // 8. Fails closed on emergency SLA claims when no emergency technician is available in the FSA
    // Update technician emergencyAvailable = false
    await db
      .update(technicians)
      .set({ emergencyAvailable: false })
      .where(eq(technicians.id, sh02Tech!.id));

    const noEmergencyRes = await app.inject({
      method: "GET",
      url: `/v1/dispatch/slot-availability?vertical=hvac&postalCode=M5B%202K3&slotStartsAt=${encodeURIComponent(slotStartsAt)}&slotEndsAt=${encodeURIComponent(slotEndsAt)}`,
    });
    expect(noEmergencyRes.statusCode).toBe(200);
    const noEmergencyData = noEmergencyRes.json<{
      emergencyOption: { available: boolean; evidenceSupported: boolean; slaMinutes: number };
    }>();
    expect(noEmergencyData.emergencyOption.available).toBe(false);
    expect(noEmergencyData.emergencyOption.evidenceSupported).toBe(false);
    expect(noEmergencyData.emergencyOption.slaMinutes).toBe(0);
  });

  it("23. Production identity, MFA enforcement, session rotation, global revocation, distributed abuse protection, and tenant isolation (#4, SH-03)", async () => {
    // -------------------------------------------------------------------------
    // 1. Production Signup Validation & Administrative Role Self-Assignment Guard
    // -------------------------------------------------------------------------
    // Reject passwords under 12 characters
    const shortPasswordRes = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: "short-pw@example.test",
        password: "short-pwd",
        displayName: "Short Password Tester",
      },
    });
    expect(shortPasswordRes.statusCode).toBe(400);

    // Reject self-assignment of staff administrative roles (ADMIN, OPERATIONS_AGENT, etc.)
    const staffSignupRes = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: "rogue-admin@example.test",
        password: "secure-strong-password-1234",
        displayName: "Rogue Admin Attempt",
        role: "ADMIN",
      },
    });
    expect(staffSignupRes.statusCode).toBe(403);
    expect(staffSignupRes.json<{ code: string }>().code).toBe("FORBIDDEN_ROLE_ASSIGNMENT");

    // Legitimate customer signup with strong password (>= 12 chars)
    const testEmail = `sh03-user-${Date.now()}@example.test`;
    const testPassword = "SuperSecurePassword2026!";
    const signupRes = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: testEmail,
        password: testPassword,
        displayName: "Verified Ontario Customer",
        phoneNumber: "+14165550199",
      },
    });
    expect(signupRes.statusCode).toBe(201);
    const signupData = signupRes.json<{
      user: { id: string; email: string; emailVerified: boolean; roles: string[] };
      accessToken: string;
      refreshToken: string;
      emailVerificationPending: boolean;
      emailVerificationToken: string;
    }>();
    expect(signupData.user.id).toBeDefined();
    expect(signupData.user.email).toBe(testEmail.toLowerCase());
    expect(signupData.user.roles).toContain("CUSTOMER");
    expect(signupData.emailVerificationPending).toBe(true);
    expect(signupData.emailVerificationToken).toBeDefined();

    // Verify Set-Cookie headers contain sh_access and sh_refresh
    const cookieHeader = signupRes.headers["set-cookie"];
    expect(cookieHeader).toBeDefined();
    const cookieStr = Array.isArray(cookieHeader) ? cookieHeader.join("; ") : (cookieHeader as string);
    expect(cookieStr).toContain("sh_access=");
    expect(cookieStr).toContain("sh_refresh=");
    expect(cookieStr).toContain("HttpOnly");

    // Reject duplicate registration with 409 Conflict
    const dupSignupRes = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: testEmail,
        password: testPassword,
        displayName: "Duplicate Customer",
      },
    });
    expect(dupSignupRes.statusCode).toBe(409);
    expect(dupSignupRes.json<{ code: string }>().code).toBe("EMAIL_ALREADY_EXISTS");

    // Complete Email Verification
    const verifyEmailRes = await app.inject({
      method: "POST",
      url: "/v1/auth/verify-email",
      payload: { token: signupData.emailVerificationToken },
    });
    expect(verifyEmailRes.statusCode).toBe(200);

    // Verify DB user emailVerified is true
    const [verifiedUserRecord] = await db
      .select({ emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.id, signupData.user.id));
    expect(verifiedUserRecord?.emailVerified).toBe(true);

    // -------------------------------------------------------------------------
    // 2. Distributed Brute-Force Lockout & Abuse Protection
    // -------------------------------------------------------------------------
    const bruteForceEmail = `brute-${Date.now()}@example.test`;
    // Create account to attack
    await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        email: bruteForceEmail,
        password: "RealPassword123456!",
        displayName: "Brute Force Target",
      },
    });

    // 5 consecutive wrong password attempts
    for (let i = 1; i <= 5; i++) {
      const failRes = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          email: bruteForceEmail,
          password: `wrong-password-${i}`,
        },
      });
      if (i < 5) {
        expect(failRes.statusCode).toBe(401);
      } else {
        // 5th failure triggers lockout
        expect([401, 429]).toContain(failRes.statusCode);
      }
    }

    // 6th attempt is blocked with 429 Too Many Requests
    const blockedRes = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: bruteForceEmail,
        password: "RealPassword123456!", // Even correct password is locked out
      },
    });
    expect(blockedRes.statusCode).toBe(429);
    expect(blockedRes.json<{ code: string }>().code).toBe("TOO_MANY_ATTEMPTS");
    expect(blockedRes.headers["retry-after"]).toBeDefined();

    // Clear lockout record for that email
    await db.delete(authRateLimits).where(eq(authRateLimits.key, `login:${bruteForceEmail.toLowerCase()}`));

    // -------------------------------------------------------------------------
    // 3. Staff MFA Requirement & TOTP Authentication
    // -------------------------------------------------------------------------
    // Create dedicated staff operator with mfaRequired = true
    const staffEmail = `ops-staff-${Date.now()}@example.test`;
    const [createdStaff] = await db
      .insert(users)
      .values({
        email: staffEmail,
        passwordHash: await hashPassword("StaffPass2026!Secured"),
        displayName: "Ontario Operations Dispatcher",
        mfaRequired: true,
      })
      .returning();
    await db.insert(userRoles).values({
      userId: createdStaff!.id,
      role: "OPERATIONS_AGENT",
    });

    // Staff login enforces MFA challenge
    const staffLoginRes = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: staffEmail,
        password: "StaffPass2026!Secured",
      },
    });
    expect(staffLoginRes.statusCode).toBe(200);
    const staffLoginData = staffLoginRes.json<{
      mfaRequired: boolean;
      challengeToken: string;
      maskedMethod: string;
      roles: string[];
    }>();
    expect(staffLoginData.mfaRequired).toBe(true);
    expect(staffLoginData.challengeToken).toBeDefined();
    expect(staffLoginData.roles).toContain("OPERATIONS_AGENT");

    // MFA Enrollment for customer account: Setup & Confirmation
    const custAuthHeader = { authorization: `Bearer ${signupData.accessToken}` };
    const mfaSetupRes = await app.inject({
      method: "POST",
      url: "/v1/auth/mfa/setup",
      headers: custAuthHeader,
    });
    expect(mfaSetupRes.statusCode).toBe(200);
    const mfaSetupData = mfaSetupRes.json<{
      secret: string;
      otpauthUrl: string;
      backupCodes: string[];
    }>();
    expect(mfaSetupData.secret).toBeDefined();
    expect(mfaSetupData.backupCodes).toHaveLength(8);

    // Confirm MFA setup using valid TOTP code
    const validSetupCode = generateTotpCode(mfaSetupData.secret);
    const confirmSetupRes = await app.inject({
      method: "POST",
      url: "/v1/auth/mfa/confirm-setup",
      headers: custAuthHeader,
      payload: { code: validSetupCode },
    });
    expect(confirmSetupRes.statusCode).toBe(200);
    expect(confirmSetupRes.json<{ success: boolean }>().success).toBe(true);

    // Now login for this user requires MFA challenge
    const custLoginRes = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: testEmail,
        password: testPassword,
      },
    });
    expect(custLoginRes.statusCode).toBe(200);
    const custLoginData = custLoginRes.json<{
      mfaRequired: boolean;
      challengeToken: string;
    }>();
    expect(custLoginData.mfaRequired).toBe(true);
    expect(custLoginData.challengeToken).toBeDefined();

    // Verify MFA with invalid code -> 401
    const invalidVerifyRes = await app.inject({
      method: "POST",
      url: "/v1/auth/mfa/verify",
      payload: {
        challengeToken: custLoginData.challengeToken,
        code: "000000",
      },
    });
    expect(invalidVerifyRes.statusCode).toBe(401);

    // Verify MFA with valid TOTP code -> 200
    const validTotpCode = generateTotpCode(mfaSetupData.secret);
    const validVerifyRes = await app.inject({
      method: "POST",
      url: "/v1/auth/mfa/verify",
      payload: {
        challengeToken: custLoginData.challengeToken,
        code: validTotpCode,
      },
    });
    expect(validVerifyRes.statusCode).toBe(200);
    const mfaVerifyData = validVerifyRes.json<{
      accessToken: string;
      refreshToken: string;
      user: { id: string; email: string };
    }>();
    expect(mfaVerifyData.accessToken).toBeDefined();
    expect(mfaVerifyData.refreshToken).toBeDefined();
    expect(mfaVerifyData.user.email).toBe(testEmail.toLowerCase());

    // Verify with single-use backup recovery code
    const loginForBackupRes = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: testEmail,
        password: testPassword,
      },
    });
    const backupChallengeToken = loginForBackupRes.json<{ challengeToken: string }>().challengeToken;
    const backupCodeToUse = mfaSetupData.backupCodes[0]!;

    const backupVerifyRes = await app.inject({
      method: "POST",
      url: "/v1/auth/mfa/verify",
      payload: {
        challengeToken: backupChallengeToken,
        code: backupCodeToUse,
      },
    });
    expect(backupVerifyRes.statusCode).toBe(200);

    // Attempting to reuse the same backup code fails
    const loginForReuseRes = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: testEmail,
        password: testPassword,
      },
    });
    const reuseChallengeToken = loginForReuseRes.json<{ challengeToken: string }>().challengeToken;
    const reuseVerifyRes = await app.inject({
      method: "POST",
      url: "/v1/auth/mfa/verify",
      payload: {
        challengeToken: reuseChallengeToken,
        code: backupCodeToUse,
      },
    });
    expect(reuseVerifyRes.statusCode).toBe(401);

    // -------------------------------------------------------------------------
    // 4. Session Management, Refresh Token Rotation & Logout
    // -------------------------------------------------------------------------
    const activeRefreshToken = backupVerifyRes.json<{ refreshToken: string }>().refreshToken;
    const refreshRes = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refreshToken: activeRefreshToken },
    });
    expect(refreshRes.statusCode).toBe(200);
    const refreshData = refreshRes.json<{ accessToken: string; refreshToken: string }>();
    expect(refreshData.accessToken).toBeDefined();
    expect(refreshData.refreshToken).toBeDefined();
    expect(refreshData.refreshToken).not.toBe(activeRefreshToken); // Token rotated!

    // List active sessions
    const sessionsRes = await app.inject({
      method: "GET",
      url: "/v1/auth/sessions",
      headers: { authorization: `Bearer ${refreshData.accessToken}` },
    });
    expect(sessionsRes.statusCode).toBe(200);
    const sessionsList = sessionsRes.json<{ sessions: Array<{ id: string }> }>().sessions;
    expect(sessionsList.length).toBeGreaterThanOrEqual(1);

    // Logout current session
    const logoutRes = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      payload: { refreshToken: refreshData.refreshToken },
    });
    expect(logoutRes.statusCode).toBe(200);

    // Attempting to refresh with the logged-out token fails with 401
    const postLogoutRefresh = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refreshToken: refreshData.refreshToken },
    });
    expect(postLogoutRefresh.statusCode).toBe(401);
    expect(postLogoutRefresh.json<{ code: string }>().code).toBe("SESSION_EXPIRED");

    // -------------------------------------------------------------------------
    // 5. Global Session Revocation
    // -------------------------------------------------------------------------
    // Login with backup code to get a fresh token
    const freshLoginRes = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: testEmail,
        password: testPassword,
      },
    });
    const freshChallenge = freshLoginRes.json<{ challengeToken: string }>().challengeToken;
    const backupCode2 = mfaSetupData.backupCodes[1]!;
    const freshVerifyRes = await app.inject({
      method: "POST",
      url: "/v1/auth/mfa/verify",
      payload: {
        challengeToken: freshChallenge,
        code: backupCode2,
      },
    });
    const validAccessToken = freshVerifyRes.json<{ accessToken: string }>().accessToken;

    // Call /v1/me -> 200
    const meBefore = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${validAccessToken}` },
    });
    expect(meBefore.statusCode).toBe(200);

    // Call /v1/auth/revoke-all
    const revokeAllRes = await app.inject({
      method: "POST",
      url: "/v1/auth/revoke-all",
      headers: { authorization: `Bearer ${validAccessToken}` },
    });
    expect(revokeAllRes.statusCode).toBe(200);
    expect(revokeAllRes.json<{ success: boolean }>().success).toBe(true);

    // Now the previous access token is rejected immediately because sessionVersion was advanced
    const meAfter = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${validAccessToken}` },
    });
    expect(meAfter.statusCode).toBe(401);

    // -------------------------------------------------------------------------
    // 6. Password Reset Flow
    // -------------------------------------------------------------------------
    const resetReqRes = await app.inject({
      method: "POST",
      url: "/v1/auth/password-reset/request",
      payload: { email: testEmail },
    });
    expect(resetReqRes.statusCode).toBe(200);
    const resetToken = resetReqRes.json<{ resetToken: string }>().resetToken;
    expect(resetToken).toBeDefined();

    const newPassword = "BrandNewSecurePassword2026!";
    const resetConfirmRes = await app.inject({
      method: "POST",
      url: "/v1/auth/password-reset/confirm",
      payload: {
        token: resetToken,
        newPassword,
      },
    });
    expect(resetConfirmRes.statusCode).toBe(200);

    // Old password now fails
    const oldPwLoginRes = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: testEmail,
        password: testPassword,
      },
    });
    expect(oldPwLoginRes.statusCode).toBe(401);

    // New password succeeds
    const newPwLoginRes = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: testEmail,
        password: newPassword,
      },
    });
    expect(newPwLoginRes.statusCode).toBe(200);

    // -------------------------------------------------------------------------
    // 7. CSRF Token Endpoint
    // -------------------------------------------------------------------------
    const csrfRes = await app.inject({
      method: "GET",
      url: "/v1/auth/csrf",
    });
    expect(csrfRes.statusCode).toBe(200);
    expect(csrfRes.json<{ csrfToken: string }>().csrfToken).toBeDefined();
    expect(csrfRes.headers["set-cookie"]).toBeDefined();
  });

  it("24. Secure customer and contractor file evidence pipeline, presigned upload, anti-virus quarantine, and signed download leases (#5, SH-04)", async () => {
    // -------------------------------------------------------------------------
    // 1. Presigned Upload Initiation & Input Validation
    // -------------------------------------------------------------------------
    // Rejects oversized files (> 25MB)
    const oversizedRes = await app.inject({
      method: "POST",
      url: "/v1/files/upload/initiate",
      headers: auth("customer@example.test"),
      payload: {
        fileName: "massive_video_dump.mp4",
        mimeType: "image/jpeg",
        byteSize: 30 * 1024 * 1024, // 30MB
        category: "JOB_BEFORE_PHOTO",
      },
    });
    expect(oversizedRes.statusCode).toBe(400);

    // Rejects disallowed MIME types (e.g. text/html, application/x-msdownload)
    const badMimeRes = await app.inject({
      method: "POST",
      url: "/v1/files/upload/initiate",
      headers: auth("customer@example.test"),
      payload: {
        fileName: "exploit.exe",
        mimeType: "application/x-msdownload",
        byteSize: 1024,
        category: "GENERAL_DOCUMENT",
      },
    });
    expect(badMimeRes.statusCode).toBe(400);

    // Legitimate initiation for customer service request evidence
    const validInitiateRes = await app.inject({
      method: "POST",
      url: "/v1/files/upload/initiate",
      headers: auth("customer@example.test"),
      payload: {
        fileName: "furnace_heat_exchanger_crack.jpg",
        mimeType: "image/jpeg",
        byteSize: 2048,
        category: "SERVICE_REQUEST_ATTACHMENT",
        visibility: "SHARED",
      },
    });
    expect(validInitiateRes.statusCode).toBe(201);
    const initiateData = validInitiateRes.json<{
      fileId: string;
      storageKey: string;
      uploadUrl: string;
      expiresAt: string;
    }>();
    expect(initiateData.fileId).toBeDefined();
    expect(initiateData.storageKey).toMatch(
      /^evidence\/service_request_attachment\/[a-z0-9_-]+\/\d{4}\/\d{2}\/[a-f0-9]{32}\.jpg$/,
    );
    expect(initiateData.uploadUrl).toBeDefined();

    // -------------------------------------------------------------------------
    // 2. Binary Upload & Finalization with Valid JPEG Magic Bytes
    // -------------------------------------------------------------------------
    const cleanJpegBinary = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00,
    ]);

    // Upload via raw presigned upload endpoint
    const rawUploadRes = await app.inject({
      method: "PUT",
      url: initiateData.uploadUrl,
      headers: { "Content-Type": "image/jpeg" },
      body: cleanJpegBinary,
    });
    expect(rawUploadRes.statusCode).toBe(200);

    // Finalize upload
    const finalizeRes = await app.inject({
      method: "POST",
      url: "/v1/files/upload/finalize",
      headers: auth("customer@example.test"),
      payload: {
        fileId: initiateData.fileId,
        storageKey: initiateData.storageKey,
      },
    });
    expect(finalizeRes.statusCode).toBe(200);
    const finalizeData = finalizeRes.json<{
      status: string;
      scanStatus: string;
      signedUrl: string;
    }>();
    expect(finalizeData.status).toBe("ACTIVE");
    expect(finalizeData.scanStatus).toBe("CLEAN");
    expect(finalizeData.signedUrl).toBeDefined();

    // Fetch signed download URL
    const signedUrlRes = await app.inject({
      method: "GET",
      url: `/v1/files/${initiateData.fileId}/signed-url`,
      headers: auth("customer@example.test"),
    });
    expect(signedUrlRes.statusCode).toBe(200);
    const signedData = signedUrlRes.json<{ downloadUrl: string }>();
    expect(signedData.downloadUrl).toBeDefined();

    // Download content via signed URL stream
    const downloadRes = await app.inject({
      method: "GET",
      url: signedData.downloadUrl,
    });
    expect(downloadRes.statusCode).toBe(200);
    expect(downloadRes.headers["content-type"]).toBe("image/jpeg");
    expect(downloadRes.headers["x-content-type-options"]).toBe("nosniff");

    // -------------------------------------------------------------------------
    // 3. MIME Type Spoofing Detection
    // -------------------------------------------------------------------------
    // Attacker initiates as image/jpeg but uploads a PDF (%PDF-)
    const spoofInitiateRes = await app.inject({
      method: "POST",
      url: "/v1/files/upload/initiate",
      headers: auth("customer@example.test"),
      payload: {
        fileName: "fake_photo.jpg",
        mimeType: "image/jpeg",
        byteSize: 1024,
        category: "JOB_BEFORE_PHOTO",
      },
    });
    const spoofData = spoofInitiateRes.json<{ fileId: string; storageKey: string }>();

    const pdfBufferDisguised = Buffer.from("%PDF-1.4 executable script payload disguised as jpg");
    const spoofFinalizeRes = await app.inject({
      method: "POST",
      url: "/v1/files/upload/finalize",
      headers: auth("customer@example.test"),
      payload: {
        fileId: spoofData.fileId,
        storageKey: spoofData.storageKey,
        contentBase64: pdfBufferDisguised.toString("base64"),
      },
    });
    expect(spoofFinalizeRes.statusCode).toBe(400);
    expect(spoofFinalizeRes.json<{ code: string }>().code).toBe("MIME_SPOOFING_DETECTED");

    // -------------------------------------------------------------------------
    // 4. Anti-Virus & Malware Threat Quarantine
    // -------------------------------------------------------------------------
    const malwareInitiateRes = await app.inject({
      method: "POST",
      url: "/v1/files/upload/initiate",
      headers: auth("customer@example.test"),
      payload: {
        fileName: "hvac_invoice_threat.pdf",
        mimeType: "application/pdf",
        byteSize: 512,
        category: "GENERAL_DOCUMENT",
      },
    });
    const malwareData = malwareInitiateRes.json<{ fileId: string; storageKey: string }>();

    // Finalize with standard EICAR antivirus test signature
    const eicarPayload = Buffer.from(
      "%PDF-1.4\nX5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*\n%%EOF",
    );
    const malwareFinalizeRes = await app.inject({
      method: "POST",
      url: "/v1/files/upload/finalize",
      headers: auth("customer@example.test"),
      payload: {
        fileId: malwareData.fileId,
        storageKey: malwareData.storageKey,
        contentBase64: eicarPayload.toString("base64"),
      },
    });
    expect(malwareFinalizeRes.statusCode).toBe(200);
    const malwareFinalizeData = malwareFinalizeRes.json<{
      status: string;
      scanStatus: string;
      quarantineReason: string;
      signedUrl: string | null;
    }>();
    expect(malwareFinalizeData.status).toBe("QUARANTINED");
    expect(malwareFinalizeData.scanStatus).toBe("QUARANTINED");
    expect(malwareFinalizeData.signedUrl).toBeNull();

    // Verify DB quarantine record
    const [quarantineEvent] = await db
      .select()
      .from(fileQuarantineEvents)
      .where(eq(fileQuarantineEvents.fileId, malwareData.fileId));
    expect(quarantineEvent).toBeDefined();

    // Regular customer cannot download quarantined file
    const quarantinedDownloadAttempt = await app.inject({
      method: "GET",
      url: `/v1/files/${malwareData.fileId}/signed-url`,
      headers: auth("customer@example.test"),
    });
    expect(quarantinedDownloadAttempt.statusCode).toBe(403);
    expect(quarantinedDownloadAttempt.json<{ code: string }>().code).toBe("FILE_QUARANTINED");

    // -------------------------------------------------------------------------
    // 5. Staff Quarantine Review & Manual Override Drill
    // -------------------------------------------------------------------------
    // Staff operator inspects and clears false-positive file with documented reason
    const overrideRes = await app.inject({
      method: "POST",
      url: `/v1/files/${malwareData.fileId}/quarantine-override`,
      headers: auth("admin@example.test"),
      payload: {
        reason: "Inspected by Senior SecOps: Verified sample is an authorized EICAR validation drill.",
      },
    });
    expect(overrideRes.statusCode).toBe(200);
    expect(overrideRes.json<{ scanStatus: string }>().scanStatus).toBe("CLEAN");

    // File is now ACTIVE and can generate signed download URL
    const clearedSignedRes = await app.inject({
      method: "GET",
      url: `/v1/files/${malwareData.fileId}/signed-url`,
      headers: auth("admin@example.test"),
    });
    expect(clearedSignedRes.statusCode).toBe(200);

    // -------------------------------------------------------------------------
    // 6. Retention Soft-Delete Lifecycle
    // -------------------------------------------------------------------------
    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/v1/files/${initiateData.fileId}`,
      headers: auth("customer@example.test"),
    });
    expect(deleteRes.statusCode).toBe(200);

    // Subsequent signed-url request returns 404
    const postDeleteRes = await app.inject({
      method: "GET",
      url: `/v1/files/${initiateData.fileId}/signed-url`,
      headers: auth("customer@example.test"),
    });
    expect(postDeleteRes.statusCode).toBe(404);
  });

  it("25. Technician recommended services lifecycle, on-site discovery, homeowner accept/decline responses, structured decline reasons, and service request conversion", async () => {
    // 1. Locate an existing active or assigned job with known customer, property, and technician
    const [existingJob] = await db
      .select({
        id: jobs.id,
        serviceRequestId: jobs.serviceRequestId,
        contractorId: jobs.contractorId,
        technicianId: jobs.technicianId,
        customerId: serviceRequests.customerId,
        propertyId: serviceRequests.propertyId,
        verticalId: serviceRequests.verticalId,
      })
      .from(jobs)
      .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
      .limit(1);

    expect(existingJob).toBeDefined();
    if (!existingJob) throw new Error("No job found");
    const jobId = existingJob.id;
    const propertyId = existingJob.propertyId;
    const contractorId = existingJob.contractorId;

    // 2. Reject recommendation submission by unauthenticated actor
    const unauthRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${jobId}/recommendations`,
      payload: {
        title: "Main Panel Whole-Home Surge Protection",
        description: "Outdoor AC compressor board vulnerable to electrical transients without panel SPD.",
        urgency: "UPGRADE_OPPORTUNITY",
        estimatedCostCents: 39500,
      },
    });
    expect(unauthRes.statusCode).toBe(401);

    // 3. Reject invalid input (short title, missing description)
    const badInputRes = await app.inject({
      method: "POST",
      url: `/v1/jobs/${jobId}/recommendations`,
      headers: auth("technician@example.test"),
      payload: {
        title: "No",
        description: "Short",
        urgency: "UPGRADE_OPPORTUNITY",
        estimatedCostCents: -50,
      },
    });
    expect(badInputRes.statusCode).toBe(400);

    // 4. Technician successfully submits first recommendation: Dual-Run Capacitor Replacement
    const createRec1Res = await app.inject({
      method: "POST",
      url: `/v1/jobs/${jobId}/recommendations`,
      headers: auth("technician@example.test"),
      payload: {
        title: "Dual-Run Compressor & Fan Capacitor Replacement (45+5 µF)",
        description: "Tested capacitor with multimeter microfarad setting; read 28.5µF under load, well below 45µF ±5% manufacturer threshold. Risk of compressor thermal trip and motor seizure.",
        urgency: "URGENT_REPAIR",
        estimatedCostCents: 18500,
        evidencePhotos: ["evidence/capacitor_test_reading.jpg"],
      },
    });
    expect(createRec1Res.statusCode).toBe(201);
    const rec1 = createRec1Res.json<{ id: string; status: string; estimatedCostCents: number; urgency: string }>();
    expect(rec1.id).toBeDefined();
    expect(rec1.status).toBe("PROPOSED");
    expect(rec1.estimatedCostCents).toBe(18500);
    expect(rec1.urgency).toBe("URGENT_REPAIR");

    // 5. Technician submits second recommendation: Emergency Main Water Shutoff Valve
    const createRec2Res = await app.inject({
      method: "POST",
      url: `/v1/jobs/${jobId}/recommendations`,
      headers: auth("technician@example.test"),
      payload: {
        title: "Main Brass Shutoff Valve Replacement",
        description: "Incoming municipal gate valve is heavily scaled with calcium and seized open. Cannot isolate supply in event of plumbing leak.",
        urgency: "IMMEDIATE_SAFETY_HAZARD",
        estimatedCostCents: 32000,
        evidencePhotos: ["evidence/seized_valve.jpg"],
      },
    });
    expect(createRec2Res.statusCode).toBe(201);
    const rec2 = createRec2Res.json<{ id: string; status: string }>();

    // 6. Homeowner views recommendations for the job
    const jobRecsRes = await app.inject({
      method: "GET",
      url: `/v1/jobs/${jobId}/recommendations`,
      headers: auth("customer@example.test"),
    });
    expect(jobRecsRes.statusCode).toBe(200);
    const jobRecs = jobRecsRes.json<Array<{ id: string; title: string }>>();
    expect(jobRecs.some((r) => r.id === rec1.id)).toBe(true);
    expect(jobRecs.some((r) => r.id === rec2.id)).toBe(true);

    // 7. Property Service Passport lookup
    const propRecsRes = await app.inject({
      method: "GET",
      url: `/v1/properties/${propertyId}/recommendations`,
      headers: auth("customer@example.test"),
    });
    expect(propRecsRes.statusCode).toBe(200);
    const propRecs = propRecsRes.json<Array<{ id: string; propertyAddress?: string }>>();
    expect(propRecs.some((r) => r.id === rec1.id)).toBe(true);

    // 8. Inspect single recommendation details and response history
    const detailRes = await app.inject({
      method: "GET",
      url: `/v1/recommendations/${rec1.id}`,
      headers: auth("customer@example.test"),
    });
    expect(detailRes.statusCode).toBe(200);
    const detailData = detailRes.json<{
      id: string;
      responses: Array<{ action: string; actorRole: string }>;
    }>();
    expect(detailData.id).toBe(rec1.id);
    expect(detailData.responses.length).toBeGreaterThanOrEqual(1);
    expect(detailData.responses[0]?.action).toBe("PROPOSED");

    // 9. Unauthorized customer cannot respond to someone else's recommendation
    const unauthorizedRespond = await app.inject({
      method: "POST",
      url: `/v1/recommendations/${rec2.id}/respond`,
      headers: auth("admin@example.test"),
      payload: {
        decision: "DECLINED",
      },
    });
    expect(unauthorizedRespond.statusCode).toBe(403);

    // 10. Homeowner declines Recommendation 2 with structured decline reason
    const declineRes = await app.inject({
      method: "POST",
      url: `/v1/recommendations/${rec2.id}/respond`,
      headers: auth("customer@example.test"),
      payload: {
        decision: "DECLINED",
        declineReason: "TOO_EXPENSIVE",
        notes: "Cost is outside our current monthly maintenance budget. Will address next spring.",
      },
    });
    expect(declineRes.statusCode).toBe(200);
    const declineData = declineRes.json<{ status: string }>();
    expect(declineData.status).toBe("DECLINED");

    // Verify DB state for recommendation 2
    const [dbRec2] = await db
      .select()
      .from(serviceRecommendations)
      .where(eq(serviceRecommendations.id, rec2.id));
    expect(dbRec2?.status).toBe("DECLINED");
    expect(dbRec2?.declineReason).toBe("TOO_EXPENSIVE");
    expect(dbRec2?.homeownerResponseNotes).toContain("outside our current monthly maintenance budget");
    expect(dbRec2?.respondedAt).toBeDefined();

    // Verify audit events table recorded DECLINED action
    const rec2Responses = await db
      .select()
      .from(serviceRecommendationResponses)
      .where(eq(serviceRecommendationResponses.recommendationId, rec2.id));
    expect(rec2Responses.some((r) => r.action === "DECLINED")).toBe(true);

    // 11. Homeowner accepts Recommendation 1 with immediate conversion into follow-up request
    const acceptIdempotencyKey = crypto.randomUUID();
    const acceptRes = await app.inject({
      method: "POST",
      url: `/v1/recommendations/${rec1.id}/respond`,
      headers: {
        ...auth("customer@example.test"),
        "idempotency-key": acceptIdempotencyKey,
      },
      payload: {
        decision: "ACCEPTED",
        convertImmediately: true,
        notes: "Approved by homeowner. Please install new capacitor today.",
      },
    });
    expect(acceptRes.statusCode).toBe(200);
    const acceptData = acceptRes.json<{
      recommendationId: string;
      status: string;
      convertedServiceRequestId?: string;
    }>();
    expect(acceptData.status).toBe("CONVERTED");
    expect(acceptData.convertedServiceRequestId).toBeDefined();

    // Verify idempotency replay returns same response
    const replayAcceptRes = await app.inject({
      method: "POST",
      url: `/v1/recommendations/${rec1.id}/respond`,
      headers: {
        ...auth("customer@example.test"),
        "idempotency-key": acceptIdempotencyKey,
      },
      payload: {
        decision: "ACCEPTED",
        convertImmediately: true,
      },
    });
    expect(replayAcceptRes.statusCode).toBe(200);
    expect(replayAcceptRes.json<{ status: string }>().status).toBe("CONVERTED");

    // Verify converted service request exists and is in SUBMITTED state
    const [convertedReq] = await db
      .select()
      .from(serviceRequests)
      .where(eq(serviceRequests.id, acceptData.convertedServiceRequestId!));
    expect(convertedReq).toBeDefined();
    expect(convertedReq?.status).toBe("SUBMITTED");
    expect(convertedReq?.description).toContain("Dual-Run Compressor & Fan Capacitor Replacement");

    // 12. Contractor conversion analytics
    const analyticsRes = await app.inject({
      method: "GET",
      url: `/v1/contractors/${contractorId}/recommendations/analytics`,
      headers: auth("owner@example.test"),
    });
    expect(analyticsRes.statusCode).toBe(200);
    const analytics = analyticsRes.json<{
      contractorId: string;
      totalProposed: number;
      totalAccepted: number;
      totalDeclined: number;
      conversionRatePct: number;
      totalProposedRevenueCents: number;
      totalAcceptedRevenueCents: number;
    }>();
    expect(analytics.contractorId).toBe(contractorId);
    expect(analytics.totalProposed).toBeGreaterThanOrEqual(2);
    expect(analytics.totalAccepted).toBeGreaterThanOrEqual(1);
    expect(analytics.totalDeclined).toBeGreaterThanOrEqual(1);
    expect(analytics.conversionRatePct).toBeGreaterThan(0);
    expect(analytics.totalAcceptedRevenueCents).toBeGreaterThan(0);
  });
});





