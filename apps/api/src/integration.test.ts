import dotenv from "dotenv";
dotenv.config({
  path: [new URL("../../../.env", import.meta.url).pathname, ".env"],
});
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled =
  (process.env.MARKETPLACE_INTEGRATION === "1" ||
    process.env.SKILLED_HIRE_INTEGRATION === "1") &&
  Boolean(process.env.DATABASE_URL);
describe.runIf(enabled)("Skilled Hire lifecycle", () => {
  let app: Awaited<typeof import("./server.js")>["app"];
  let pool: Awaited<typeof import("@marketplace/database")>["pool"];
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
    ({ pool } = await import("@marketplace/database"));
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
  });

  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  it("creates, dispatches, quotes, pays, completes, invoices, and reviews a job", async () => {
    const seed = await pool.query<{
      vertical_id: string;
      category_id: string;
      issue_type_id: string;
      property_id: string;
    }>(
      "SELECT v.id vertical_id,c.id category_id,i.id issue_type_id,p.id property_id FROM verticals v JOIN service_categories c ON c.vertical_id=v.id JOIN issue_types i ON i.category_id=c.id JOIN properties p ON p.customer_id=(SELECT id FROM users WHERE email='customer@example.test') WHERE v.slug='hvac' AND i.slug='ac-not-cooling' LIMIT 1",
    );
    const context = seed.rows[0];
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

    const milestone = await pool.query<{ id: string }>(
      "SELECT id FROM payment_milestones WHERE schedule_id=(SELECT id FROM payment_schedules WHERE quote_id=$1) ORDER BY sequence LIMIT 1",
      [quoteId],
    );
    const depositId = milestone.rows[0]?.id;
    const finalBeforeDeposit = await pool.query<{ id: string }>(
      "SELECT id FROM payment_milestones WHERE schedule_id=(SELECT id FROM payment_schedules WHERE quote_id=$1) ORDER BY sequence DESC LIMIT 1",
      [quoteId],
    );
    if (!depositId || !finalBeforeDeposit.rows[0]?.id)
      throw new Error("Missing payment milestones");

    // Out of order payment rejected with 409
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/v1/payment-milestones/${finalBeforeDeposit.rows[0].id}/pay`,
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

    const finalMilestone = await pool.query<{ id: string }>(
      "SELECT id FROM payment_milestones WHERE schedule_id=(SELECT id FROM payment_schedules WHERE quote_id=$1) AND status='PENDING' ORDER BY sequence LIMIT 1",
      [quoteId],
    );
    const finalId = finalMilestone.rows[0]?.id;
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

    const relationship = await pool.query<{ last_platform_job_id: string }>(
      "SELECT last_platform_job_id FROM customer_contractor_relationships WHERE customer_id=(SELECT id FROM users WHERE email='customer@example.test') AND contractor_id=(SELECT contractor_id FROM jobs WHERE id=$1)",
      [jobId],
    );
    expect(relationship.rows[0]?.last_platform_job_id).toBe(jobId);
  });

  it("handles change orders, customer approvals, and dynamic milestone updates", async () => {
    const seed = await pool.query<{
      vertical_id: string;
      category_id: string;
      issue_type_id: string;
      property_id: string;
    }>(
      "SELECT v.id vertical_id,c.id category_id,i.id issue_type_id,p.id property_id FROM verticals v JOIN service_categories c ON c.vertical_id=v.id JOIN issue_types i ON i.category_id=c.id JOIN properties p ON p.customer_id=(SELECT id FROM users WHERE email='customer@example.test') WHERE v.slug='hvac' AND i.slug='ac-not-cooling' LIMIT 1",
    );
    const context = seed.rows[0];
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

    const depositMilestone = await pool.query<{ id: string }>(
      "SELECT id FROM payment_milestones WHERE schedule_id=(SELECT id FROM payment_schedules WHERE quote_id=$1) ORDER BY sequence LIMIT 1",
      [quoteId],
    );
    const depositId = depositMilestone.rows[0]?.id;
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
    const jobStatusCheck = await pool.query<{ status: string }>(
      "SELECT status FROM jobs WHERE id=$1",
      [jobId],
    );
    expect(jobStatusCheck.rows[0]?.status).toBe("CHANGE_ORDER_PENDING");

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
    const resumedStatus = await pool.query<{ status: string }>(
      "SELECT status FROM jobs WHERE id=$1",
      [jobId],
    );
    expect(resumedStatus.rows[0]?.status).toBe("WORK_IN_PROGRESS");

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

    const pendingMilestones = await pool.query<{ id: string }>(
      "SELECT id FROM payment_milestones WHERE schedule_id=(SELECT id FROM payment_schedules WHERE quote_id=$1) AND status='PENDING'",
      [quoteId],
    );
    for (const m of pendingMilestones.rows) {
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
    const contractor = await pool.query<{ id: string }>(
      "SELECT id FROM contractors LIMIT 1",
    );
    const contractorId = contractor.rows[0]?.id;
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
    const prop = await pool.query<{ id: string }>(
      "SELECT id FROM properties WHERE customer_id=(SELECT id FROM users WHERE email='customer@example.test') LIMIT 1",
    );
    const propertyId = prop.rows[0]?.id;
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
    const completedJob = await pool.query<{ id: string }>(
      "SELECT id FROM jobs WHERE status='COMPLETED' LIMIT 1",
    );
    const jobId = completedJob.rows[0]?.id;
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
    const transaction = await pool.query<{ id: string; amount_cents: string }>(
      "SELECT pt.id, pt.amount_cents FROM payment_transactions pt LEFT JOIN refunds r ON r.transaction_id=pt.id AND r.status='REFUNDED' WHERE pt.status='PAID' GROUP BY pt.id HAVING (pt.amount_cents - COALESCE(sum(r.amount_cents), 0)) >= 1000 ORDER BY pt.created_at DESC LIMIT 1",
    );
    const tx = transaction.rows[0];
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
    const auditRows = await pool.query<{ action: string; entity_type: string }>(
      "SELECT action, entity_type FROM audit_events WHERE entity_type IN ('VERTICAL', 'SERVICE_CATEGORY', 'ISSUE_TYPE') ORDER BY occurred_at DESC LIMIT 5",
    );
    expect(auditRows.rows.length).toBeGreaterThan(0);
  });
});
