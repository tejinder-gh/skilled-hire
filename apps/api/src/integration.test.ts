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
  auditEvents,
  refunds,
  eq,
  ne,
  and,
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
      .innerJoin(serviceCategories, eq(serviceCategories.verticalId, verticals.id))
      .innerJoin(issueTypes, eq(issueTypes.categoryId, serviceCategories.id))
      .innerJoin(properties, eq(properties.customerId, custUser.id))
      .where(and(eq(verticals.slug, "hvac"), eq(issueTypes.slug, "ac-not-cooling")))
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
      .where(and(eq(technicians.active, true), eq(technicians.displayName, "John S.")))
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
      .select({ lastPlatformJobId: customerContractorRelationships.lastPlatformJobId })
      .from(customerContractorRelationships)
      .where(
        and(
          eq(customerContractorRelationships.customerId, custUser.id),
          eq(customerContractorRelationships.contractorId, jobRecord.contractorId),
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
      .innerJoin(serviceCategories, eq(serviceCategories.verticalId, verticals.id))
      .innerJoin(issueTypes, eq(issueTypes.categoryId, serviceCategories.id))
      .innerJoin(properties, eq(properties.customerId, custUser.id))
      .where(and(eq(verticals.slug, "hvac"), eq(issueTypes.slug, "ac-not-cooling")))
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
    const standards =
      standardsRes.json<
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
    const panelResults =
      panelSearch.json<
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
    expect(matrixData.policies.some((p) => p.verticalSlug === "electrical")).toBe(true);
    expect(matrixData.policies.some((p) => p.verticalSlug === "hvac")).toBe(true);

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
          auditorNotes: "Audited against ESA/ECRA authoritative license registry",
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

    if (
      elecVertical &&
      custProp &&
      elecCategory &&
      elecIssue
    ) {
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
    expect(techSubmitsContractorRes.json<{ code: string }>().code).toBe("FORBIDDEN");

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
    expect(fakeTechRes.json<{ code: string }>().code).toBe("TECHNICIAN_NOT_FOUND");

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
    expect(crossContractorOrgRes.json<{ code: string }>().code).toBe("FORBIDDEN");

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
    expect(adminStaffOverrideRes.json<{ status: string }>().status).toBe("PENDING");

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
    expect(legitOwnerSubmitRes.json<{ status: string }>().status).toBe("PENDING");
  });
});
