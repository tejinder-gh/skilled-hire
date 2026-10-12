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
  eq,
  ne,
  and,
  or,
  asc,
  desc,
  sql,
  inArray,
} from "@marketplace/database";

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
  });

  afterAll(async () => {
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
});

