import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireRole } from "@marketplace/auth";
import type {
  CancellationQuoteResponse,
  CancelJobResponse,
  ReportNoShowResponse,
  ReassignJobResponse,
  CustomerRecoveryChoiceResponse,
  ResolveExceptionResponse,
} from "@marketplace/contracts";
import {
  db,
  eq,
  and,
  or,
  desc,
  sql,
  inArray,
  jobs,
  serviceRequests,
  contractors,
  technicians,
  users,
  dispatchExceptions,
  jobCancellations,
  customerServiceCredits,
  contractorDispatchPenalties,
  dispatchSlotHolds,
  dispatchFallbackQueue,
  marketplaceFinancialLedger,
  paymentMilestones,
  paymentSchedules,
  quotes,
  properties,
} from "@marketplace/database";
import {
  cancellationQuoteSchema,
  cancelJobSchema,
  reportNoShowSchema,
  reassignJobSchema,
  customerRecoveryChoiceSchema,
  resolveExceptionSchema,
} from "@marketplace/validation";
import {
  evaluateCancellationPolicy,
  evaluateDispatchExceptionSla,
  evaluateNoShowEligibility,
  CUSTOMER_NO_SHOW_COURTESY_CREDIT_CENTS,
  CONTRACTOR_NO_SHOW_PENALTY_CENTS,
  CONTRACTOR_NO_SHOW_STRIKE_POINTS,
} from "@marketplace/vertical-engine";
import { actor, authenticate, isOps, parse, uuid } from "../common/auth.js";
import { audit } from "../common/events.js";
import { enqueueTransactionalNotification } from "./notifications.routes.js";

export const dispatchExceptionsRoutes: FastifyPluginAsync = async (app) => {
  // -------------------------------------------------------------------------
  // 1. CANCELLATION QUOTE: Real-time policy evaluation before cancelling
  // -------------------------------------------------------------------------
  app.get(
    "/v1/jobs/:id/cancellation-quote",
    { preHandler: authenticate },
    async (request, reply) => {
      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const query = parse(cancellationQuoteSchema, request.query ?? {});
      const currentActor = actor(request);

      const [job] = await db
        .select({
          id: jobs.id,
          status: jobs.status,
          scheduledStartsAt: jobs.scheduledStartsAt,
          customerId: serviceRequests.customerId,
          contractorId: jobs.contractorId,
        })
        .from(jobs)
        .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (!job) {
        return reply.code(404).send({ code: "NOT_FOUND", message: "Job not found" });
      }

      // Check caller authorization
      if (
        !isOps(currentActor) &&
        job.customerId !== currentActor.id &&
        job.contractorId !== currentActor.contractorId
      ) {
        return reply.code(403).send({ code: "FORBIDDEN", message: "Access denied" });
      }

      // Determine calling role
      let role: "CUSTOMER" | "CONTRACTOR" | "OPERATIONS" = "CUSTOMER";
      if (isOps(currentActor)) {
        role = query.cancelledByRole ?? "OPERATIONS";
      } else if (job.contractorId === currentActor.contractorId) {
        role = "CONTRACTOR";
      }

      // Fetch paid amount from milestones
      const paidMilestones = await db
        .select({ amountCents: paymentMilestones.amountCents })
        .from(paymentMilestones)
        .innerJoin(
          paymentSchedules,
          eq(paymentSchedules.id, paymentMilestones.scheduleId),
        )
        .innerJoin(quotes, eq(quotes.id, paymentSchedules.quoteId))
        .where(
          and(
            eq(quotes.jobId, jobId),
            eq(paymentMilestones.status, "PAID"),
          ),
        );

      const amountPaidCents = paidMilestones.reduce(
        (sum, m) => sum + Number(m.amountCents),
        0,
      );

      const evaluation = evaluateCancellationPolicy({
        cancelledByRole: role,
        scheduledStartsAt: job.scheduledStartsAt,
        technicianStatus: job.status,
        amountPaidCents,
        now: new Date(),
      });

      const response: CancellationQuoteResponse = {
        jobId: job.id,
        scheduledStartsAt: job.scheduledStartsAt ? job.scheduledStartsAt.toISOString() : null,
        minutesUntilStart: evaluation.minutesUntilStart,
        policyApplied: evaluation.policyApplied,
        originalAmountPaidCents: evaluation.originalAmountPaidCents,
        cancellationFeeCents: evaluation.cancellationFeeCents,
        refundAmountCents: evaluation.refundAmountCents,
        contractorPayoutCents: evaluation.contractorPayoutCents,
        customerCreditCents: evaluation.customerCreditCents,
        explanation: evaluation.explanation,
        canCancelFree: evaluation.canCancelFree,
        freeCancellationDeadline: evaluation.freeCancellationDeadline ?? null,
      };

      return reply.code(200).send(response);
    },
  );

  // -------------------------------------------------------------------------
  // 2. CANCEL JOB: Policy-backed job cancellation with atomic outbox & ledger
  // -------------------------------------------------------------------------
  app.post(
    "/v1/jobs/:id/cancel",
    { preHandler: authenticate },
    async (request, reply) => {
      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(cancelJobSchema, request.body);
      const currentActor = actor(request);
      const now = new Date();

      const result = await db.transaction(async (tx) => {
        const [job] = await tx
          .select({
            id: jobs.id,
            status: jobs.status,
            serviceRequestId: jobs.serviceRequestId,
            scheduledStartsAt: jobs.scheduledStartsAt,
            contractorId: jobs.contractorId,
            technicianId: jobs.technicianId,
            customerId: serviceRequests.customerId,
            customerEmail: users.email,
            customerPhone: users.phoneNumber,
          })
          .from(jobs)
          .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
          .innerJoin(users, eq(users.id, serviceRequests.customerId))
          .where(eq(jobs.id, jobId))
          .for("update", { of: jobs });

        if (!job) {
          const err = new Error("Job not found");
          (err as any).statusCode = 404;
          throw err;
        }

        if (job.status === "COMPLETED" || job.status === "CLOSED") {
          const err = new Error("Cannot cancel a completed or closed job");
          (err as any).statusCode = 422;
          throw err;
        }

        if (job.status === "CANCELLED") {
          const err = new Error("Job is already cancelled");
          (err as any).statusCode = 409;
          throw err;
        }

        // Determine role
        let role: "CUSTOMER" | "CONTRACTOR" | "OPERATIONS" | "SYSTEM" = "CUSTOMER";
        if (isOps(currentActor)) {
          role = "OPERATIONS";
        } else if (job.contractorId === currentActor.contractorId) {
          role = "CONTRACTOR";
        } else if (job.customerId !== currentActor.id) {
          const err = new Error("Access denied");
          (err as any).statusCode = 403;
          throw err;
        }

        // Calculate paid milestones
        const paidMilestones = await tx
          .select({
            id: paymentMilestones.id,
            amountCents: paymentMilestones.amountCents,
          })
          .from(paymentMilestones)
          .innerJoin(
            paymentSchedules,
            eq(paymentSchedules.id, paymentMilestones.scheduleId),
          )
          .innerJoin(quotes, eq(quotes.id, paymentSchedules.quoteId))
          .where(
            and(
              eq(quotes.jobId, jobId),
              eq(paymentMilestones.status, "PAID"),
            ),
          );

        const amountPaidCents = paidMilestones.reduce(
          (sum, m) => sum + Number(m.amountCents),
          0,
        );

        const evaluation = evaluateCancellationPolicy({
          cancelledByRole: role,
          scheduledStartsAt: job.scheduledStartsAt,
          technicianStatus: job.status,
          amountPaidCents,
          reason: body.reason,
          forceMajeure: body.forceMajeure,
          now,
        });

        // 1. Insert into jobCancellations
        const [cancellationRecord] = await tx
          .insert(jobCancellations)
          .values({
            jobId: job.id,
            serviceRequestId: job.serviceRequestId,
            cancelledByRole: role,
            cancelledByUserId: currentActor.id,
            cancellationReason: body.reason,
            cancellationNotes: body.notes ?? null,
            policyApplied: evaluation.policyApplied,
            originalAmountPaidCents: evaluation.originalAmountPaidCents,
            cancellationFeeCents: evaluation.cancellationFeeCents,
            refundAmountCents: evaluation.refundAmountCents,
            contractorPayoutCents: evaluation.contractorPayoutCents,
            customerCreditCents: evaluation.customerCreditCents,
            contractorPenaltyCents: evaluation.contractorPenaltyCents,
          })
          .returning();

        if (!cancellationRecord) {
          throw new Error("Failed to insert cancellation record");
        }

        // 2. Update Job and Service Request status
        await tx
          .update(jobs)
          .set({ status: "CANCELLED", updatedAt: now })
          .where(eq(jobs.id, jobId));

        await tx
          .update(serviceRequests)
          .set({ status: "CANCELLED", updatedAt: now })
          .where(eq(serviceRequests.id, job.serviceRequestId));

        // 3. Release any slot holds
        if (job.technicianId) {
          await tx
            .update(dispatchSlotHolds)
            .set({ status: "RELEASED", updatedAt: now })
            .where(
              and(
                eq(dispatchSlotHolds.technicianId, job.technicianId),
                eq(dispatchSlotHolds.status, "CONFIRMED"),
              ),
            );
        }

        // 4. Financial Ledger: Process Refund if applicable
        if (evaluation.refundAmountCents > 0) {
          await tx.insert(marketplaceFinancialLedger).values([
            {
              entryType: "REFUND_DEBIT",
              accountType: "CUSTOMER_RECEIVABLE",
              direction: "CREDIT",
              amountCents: evaluation.refundAmountCents,
              currency: "CAD",
              customerId: job.customerId,
              contractorId: job.contractorId,
              jobId: job.id,
              description: `Cancellation refund (${evaluation.policyApplied}) for job ${job.id}`,
            },
            {
              entryType: "REFUND_DEBIT",
              accountType: "STRIPE_CLEARING",
              direction: "DEBIT",
              amountCents: evaluation.refundAmountCents,
              currency: "CAD",
              customerId: job.customerId,
              contractorId: job.contractorId,
              jobId: job.id,
              description: `Cancellation refund (${evaluation.policyApplied}) payout from clearing`,
            },
          ]);
        }

        // 5. Financial Ledger & Payout: Late cancellation fee compensation to contractor
        if (evaluation.contractorPayoutCents > 0) {
          await tx.insert(marketplaceFinancialLedger).values([
            {
              entryType: "CUSTOMER_CHARGE",
              accountType: "CONTRACTOR_PAYABLE",
              direction: "CREDIT",
              amountCents: evaluation.contractorPayoutCents,
              currency: "CAD",
              contractorId: job.contractorId,
              jobId: job.id,
              description: `Late cancellation travel compensation for job ${job.id}`,
            },
            {
              entryType: "APPLICATION_FEE",
              accountType: "PLATFORM_REVENUE",
              direction: "DEBIT",
              amountCents: evaluation.contractorPayoutCents,
              currency: "CAD",
              contractorId: job.contractorId,
              jobId: job.id,
              description: `Platform fee adjustment on cancellation compensation for job ${job.id}`,
            },
          ]);
        }

        // 6. Contractor Penalty: If contractor cancelled or faulted
        if (evaluation.contractorPenaltyCents > 0) {
          await tx.insert(contractorDispatchPenalties).values({
            contractorId: job.contractorId,
            technicianId: job.technicianId,
            jobId: job.id,
            strikeType: "LATE_CANCELLATION",
            penaltyAmountCents: evaluation.contractorPenaltyCents,
            strikePoints: 1,
            notes: `Contractor cancelled: ${body.reason}`,
            status: "ACTIVE",
          });
        }

        // 7. Customer Courtesy Credit: If contractor cancelled
        if (evaluation.customerCreditCents > 0) {
          await tx.insert(customerServiceCredits).values({
            customerId: job.customerId,
            amountCents: evaluation.customerCreditCents,
            balanceCents: evaluation.customerCreditCents,
            reason: "CANCELLATION_COURTESY",
            referenceType: "JOB",
            referenceId: job.id,
            status: "ACTIVE",
          });
        }

        // 8. Record Dispatch Exception if cancellation was unexpected or late
        if (
          role === "CONTRACTOR" ||
          evaluation.policyApplied === "LATE_CUSTOMER_CANCELLATION_FEE"
        ) {
          const exceptionType =
            role === "CONTRACTOR"
              ? "CONTRACTOR_CANCELLATION"
              : "CUSTOMER_CANCELLATION";

          await tx.insert(dispatchExceptions).values({
            serviceRequestId: job.serviceRequestId,
            jobId: job.id,
            contractorId: job.contractorId,
            technicianId: job.technicianId,
            exceptionType,
            reason: body.reason,
            notes: body.notes ?? null,
            severity: role === "CONTRACTOR" ? "HIGH" : "MEDIUM",
            status: "RESOLVED",
            slaDeadlineAt: now,
            resolvedAt: now,
            resolvedByUserId: currentActor.id,
            resolutionType:
              evaluation.refundAmountCents > 0
                ? evaluation.cancellationFeeCents > 0
                  ? "REFUNDED_PARTIAL_WITH_FEE"
                  : "REFUNDED_FULL"
                : "CANCELLED_NO_FEE",
            compensationAmountCents: evaluation.contractorPayoutCents,
            feeAmountCents: evaluation.cancellationFeeCents,
            customerCreditCents: evaluation.customerCreditCents,
          });
        }

        // 9. Enqueue Transactional Outbox Notification (SH-09 integration)
        const idempotencyKey = `evt:job:cancelled:${job.id}:${now.getTime()}`;
        await enqueueTransactionalNotification(tx, {
          aggregateType: "JOB",
          aggregateId: job.id,
          eventType: "job.cancelled",
          idempotencyKey,
          recipientUserId: job.customerId,
          channel: "EMAIL",
          destination: job.customerEmail,
          templateSlug: "job.cancelled",
          payload: {
            jobId: job.id,
            policyApplied: evaluation.policyApplied,
            cancellationFeeDollars: (evaluation.cancellationFeeCents / 100).toFixed(2),
            refundAmountDollars: (evaluation.refundAmountCents / 100).toFixed(2),
            explanation: evaluation.explanation,
          },
        });

        return {
          cancellation: {
            id: cancellationRecord.id,
            jobId: job.id,
            serviceRequestId: job.serviceRequestId,
            cancelledByRole: role,
            cancelledByUserId: currentActor.id,
            cancellationReason: body.reason,
            cancellationNotes: body.notes ?? null,
            policyApplied: evaluation.policyApplied,
            originalAmountPaidCents: evaluation.originalAmountPaidCents,
            cancellationFeeCents: evaluation.cancellationFeeCents,
            refundAmountCents: evaluation.refundAmountCents,
            contractorPayoutCents: evaluation.contractorPayoutCents,
            customerCreditCents: evaluation.customerCreditCents,
            contractorPenaltyCents: evaluation.contractorPenaltyCents,
            createdAt: cancellationRecord.createdAt.toISOString(),
            updatedAt: cancellationRecord.updatedAt.toISOString(),
          },
          refundProcessed: evaluation.refundAmountCents > 0,
          refundAmountCents: evaluation.refundAmountCents,
          cancellationFeeCents: evaluation.cancellationFeeCents,
        };
      });

      await audit(
        currentActor.id,
        "JOB_CANCELLED",
        "JOB",
        jobId,
        null,
        {
          policyApplied: result.cancellation.policyApplied,
          refundAmountCents: result.refundAmountCents,
          cancellationFeeCents: result.cancellationFeeCents,
        },
      );

      const response: CancelJobResponse = {
        cancellation: result.cancellation,
        jobId,
        jobStatus: "CANCELLED",
        refundProcessed: result.refundProcessed,
        refundAmountCents: result.refundAmountCents,
        cancellationFeeCents: result.cancellationFeeCents,
        outboxNotificationEnqueued: true,
      };

      return reply.code(200).send(response);
    },
  );

  // -------------------------------------------------------------------------
  // 3. REPORT NO-SHOW: Customer reports technician failed to arrive
  // -------------------------------------------------------------------------
  app.post(
    "/v1/jobs/:id/report-no-show",
    { preHandler: authenticate },
    async (request, reply) => {
      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(reportNoShowSchema, request.body);
      const currentActor = actor(request);
      const now = new Date();

      const result = await db.transaction(async (tx) => {
        const [job] = await tx
          .select({
            id: jobs.id,
            status: jobs.status,
            serviceRequestId: jobs.serviceRequestId,
            scheduledStartsAt: jobs.scheduledStartsAt,
            contractorId: jobs.contractorId,
            technicianId: jobs.technicianId,
            customerId: serviceRequests.customerId,
            urgency: serviceRequests.urgency,
            customerEmail: users.email,
          })
          .from(jobs)
          .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
          .innerJoin(users, eq(users.id, serviceRequests.customerId))
          .where(eq(jobs.id, jobId))
          .for("update", { of: jobs });

        if (!job) {
          const err = new Error("Job not found");
          (err as any).statusCode = 404;
          throw err;
        }

        if (!isOps(currentActor) && job.customerId !== currentActor.id) {
          const err = new Error("Access denied");
          (err as any).statusCode = 403;
          throw err;
        }

        // Check no-show eligibility
        const check = evaluateNoShowEligibility({
          scheduledStartsAt: job.scheduledStartsAt,
          technicianArrivedAt: job.status === "TECHNICIAN_ARRIVED" ? now : null,
          now,
        });

        if (!check.eligible && !isOps(currentActor)) {
          const err = new Error(check.reason ?? "Job is not eligible for no-show claim");
          (err as any).statusCode = 422;
          throw err;
        }

        // SLA determination
        const sla = evaluateDispatchExceptionSla({
          urgency: job.urgency,
          exceptionType: "TECHNICIAN_NO_SHOW",
          now,
        });

        // 1. Create dispatchException
        const [exception] = await tx
          .insert(dispatchExceptions)
          .values({
            serviceRequestId: job.serviceRequestId,
            jobId: job.id,
            contractorId: job.contractorId,
            technicianId: job.technicianId,
            exceptionType: "TECHNICIAN_NO_SHOW",
            reason: body.notes ?? "Technician failed to arrive at scheduled time",
            severity: sla.severity,
            status: "OPEN",
            slaDeadlineAt: sla.slaDeadlineAt,
            customerCreditCents: CUSTOMER_NO_SHOW_COURTESY_CREDIT_CENTS,
            feeAmountCents: 0,
            compensationAmountCents: 0,
          })
          .returning();

        if (!exception) {
          throw new Error("Failed to create dispatch exception");
        }

        // 2. Award $25 customer courtesy service credit
        const [credit] = await tx
          .insert(customerServiceCredits)
          .values({
            customerId: job.customerId,
            amountCents: CUSTOMER_NO_SHOW_COURTESY_CREDIT_CENTS,
            balanceCents: CUSTOMER_NO_SHOW_COURTESY_CREDIT_CENTS,
            reason: "NO_SHOW_COMPENSATION",
            referenceType: "DISPATCH_EXCEPTION",
            referenceId: exception.id,
            status: "ACTIVE",
          })
          .returning();

        // 3. Issue contractor strike & penalty
        await tx.insert(contractorDispatchPenalties).values({
          contractorId: job.contractorId,
          technicianId: job.technicianId,
          jobId: job.id,
          strikeType: "NO_SHOW",
          penaltyAmountCents: CONTRACTOR_NO_SHOW_PENALTY_CENTS,
          strikePoints: CONTRACTOR_NO_SHOW_STRIKE_POINTS,
          notes: `Customer reported technician no-show after ${check.minutesLate} minutes`,
          status: "ACTIVE",
        });

        // 4. Update Job status to ON_HOLD
        await tx
          .update(jobs)
          .set({ status: "ON_HOLD", updatedAt: now })
          .where(eq(jobs.id, jobId));

        // 5. Enqueue into Fallback Queue for immediate re-dispatch / triage
        await tx
          .insert(dispatchFallbackQueue)
          .values({
            serviceRequestId: job.serviceRequestId,
            failedOfferCount: 1,
            reason: "TECHNICIAN_NO_SHOW",
            status: "PENDING_TRIAGE",
          })
          .onConflictDoUpdate({
            target: [dispatchFallbackQueue.serviceRequestId],
            set: {
              failedOfferCount: sql`${dispatchFallbackQueue.failedOfferCount} + 1`,
              reason: "TECHNICIAN_NO_SHOW",
              status: "PENDING_TRIAGE",
              updatedAt: now,
            },
          });

        // 6. Release slot holds
        if (job.technicianId) {
          await tx
            .update(dispatchSlotHolds)
            .set({ status: "RELEASED", updatedAt: now })
            .where(
              and(
                eq(dispatchSlotHolds.technicianId, job.technicianId),
                eq(dispatchSlotHolds.status, "CONFIRMED"),
              ),
            );
        }

        // 7. Enqueue Transactional Outbox Notification with recovery options
        await enqueueTransactionalNotification(tx, {
          aggregateType: "JOB",
          aggregateId: job.id,
          eventType: "dispatch.no_show_recovery",
          idempotencyKey: `evt:no_show:${exception.id}:${now.getTime()}`,
          recipientUserId: job.customerId,
          channel: "SMS",
          destination: job.customerEmail,
          templateSlug: "dispatch.no_show_recovery",
          payload: {
            jobId: job.id,
            creditAmountDollars: (CUSTOMER_NO_SHOW_COURTESY_CREDIT_CENTS / 100).toFixed(2),
            slaMinutes: sla.slaMinutes,
          },
        });

        return {
          exception: {
            id: exception.id,
            serviceRequestId: exception.serviceRequestId,
            jobId: exception.jobId,
            contractorId: exception.contractorId,
            technicianId: exception.technicianId,
            exceptionType: exception.exceptionType as any,
            reason: exception.reason,
            notes: exception.notes,
            severity: exception.severity as any,
            status: exception.status as any,
            slaDeadlineAt: exception.slaDeadlineAt.toISOString(),
            escalatedAt: exception.escalatedAt ? exception.escalatedAt.toISOString() : null,
            resolvedAt: exception.resolvedAt ? exception.resolvedAt.toISOString() : null,
            resolvedByUserId: exception.resolvedByUserId,
            resolutionType: exception.resolutionType as any,
            compensationAmountCents: exception.compensationAmountCents,
            feeAmountCents: exception.feeAmountCents,
            customerCreditCents: exception.customerCreditCents,
            createdAt: exception.createdAt.toISOString(),
            updatedAt: exception.updatedAt.toISOString(),
          },
          creditId: credit?.id,
        };
      });

      await audit(
        currentActor.id,
        "TECHNICIAN_NO_SHOW_REPORTED",
        "JOB",
        jobId,
        null,
        {
          exceptionId: result.exception.id,
          creditAwardedCents: CUSTOMER_NO_SHOW_COURTESY_CREDIT_CENTS,
        },
      );

      const response: ReportNoShowResponse = {
        exception: result.exception,
        creditAwardedCents: CUSTOMER_NO_SHOW_COURTESY_CREDIT_CENTS,
        creditId: result.creditId,
        recoveryOptions: [
          "ACCEPT_REASSIGNMENT",
          "RESCHEDULE_NEW_SLOT",
          "FULL_REFUND_CANCEL",
        ],
        message:
          "No-show confirmed. $25.00 courtesy credit applied to your Skilled Hire wallet. You can now choose to reassign immediately, select another slot, or cancel for a 100% full refund.",
      };

      return reply.code(200).send(response);
    },
  );

  // -------------------------------------------------------------------------
  // 4. REASSIGN JOB: Seamless reassignment of stranded job
  // -------------------------------------------------------------------------
  app.post(
    "/v1/jobs/:id/reassign",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(
        actor(request),
        "OPERATIONS_AGENT",
        "DISPATCHER",
        "ADMIN",
        "SUPER_ADMIN",
      );
      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(reassignJobSchema, request.body);
      const currentActor = actor(request);
      const now = new Date();

      const result = await db.transaction(async (tx) => {
        const [job] = await tx
          .select({
            id: jobs.id,
            serviceRequestId: jobs.serviceRequestId,
            status: jobs.status,
            customerId: serviceRequests.customerId,
            customerEmail: users.email,
          })
          .from(jobs)
          .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
          .innerJoin(users, eq(users.id, serviceRequests.customerId))
          .where(eq(jobs.id, jobId))
          .for("update", { of: jobs });

        if (!job) {
          const err = new Error("Job not found");
          (err as any).statusCode = 404;
          throw err;
        }

        // Find candidate technician
        let targetTechId = body.newTechnicianId;
        let targetContractorId = body.newContractorId;

        if (!targetTechId) {
          const [candidate] = await tx
            .select({
              id: technicians.id,
              contractorId: technicians.contractorId,
            })
            .from(technicians)
            .innerJoin(contractors, eq(contractors.id, technicians.contractorId))
            .where(
              and(
                eq(technicians.active, true),
                eq(contractors.status, "VERIFIED"),
              ),
            )
            .limit(1);

          if (!candidate) {
            const err = new Error("No alternative active verified technician available");
            (err as any).statusCode = 422;
            throw err;
          }
          targetTechId = candidate.id;
          targetContractorId = candidate.contractorId;
        } else if (!targetContractorId) {
          const [techRow] = await tx
            .select({ contractorId: technicians.contractorId })
            .from(technicians)
            .where(eq(technicians.id, targetTechId))
            .limit(1);
          targetContractorId = techRow?.contractorId;
        }

        if (!targetContractorId) {
          throw new Error("Target contractor could not be resolved");
        }

        // Fetch tech details
        const [techDetails] = await tx
          .select({
            techName: technicians.displayName,
            contractorName: contractors.name,
          })
          .from(technicians)
          .innerJoin(contractors, eq(contractors.id, technicians.contractorId))
          .where(eq(technicians.id, targetTechId))
          .limit(1);

        const newStartsAt = new Date(now.getTime() + 45 * 60 * 1000); // ETA 45 mins
        const newEndsAt = new Date(newStartsAt.getTime() + 2 * 60 * 60 * 1000);

        // Update Job
        await tx
          .update(jobs)
          .set({
            contractorId: targetContractorId,
            technicianId: targetTechId,
            status: "ASSIGNED",
            scheduledStartsAt: newStartsAt,
            scheduledEndsAt: newEndsAt,
            updatedAt: now,
          })
          .where(eq(jobs.id, jobId));

        // Update Service Request
        await tx
          .update(serviceRequests)
          .set({ status: "ASSIGNED", updatedAt: now })
          .where(eq(serviceRequests.id, job.serviceRequestId));

        // Resolve any open exception
        const [openException] = await tx
          .select({ id: dispatchExceptions.id })
          .from(dispatchExceptions)
          .where(
            and(
              eq(dispatchExceptions.jobId, jobId),
              eq(dispatchExceptions.status, "OPEN"),
            ),
          )
          .limit(1);

        if (openException) {
          await tx
            .update(dispatchExceptions)
            .set({
              status: "RESOLVED",
              resolutionType: "REASSIGNED",
              resolvedAt: now,
              resolvedByUserId: currentActor.id,
              notes: body.notes ?? body.overrideReason ?? "Manually reassigned by operations",
              updatedAt: now,
            })
            .where(eq(dispatchExceptions.id, openException.id));
        }

        // Resolve fallback queue
        await tx
          .update(dispatchFallbackQueue)
          .set({
            status: "MANUALLY_ASSIGNED",
            assignedTechnicianId: targetTechId,
            triagedByUserId: currentActor.id,
            triagedAt: now,
            resolutionNotes: body.notes ?? "Reassigned to alternative technician",
            updatedAt: now,
          })
          .where(eq(dispatchFallbackQueue.serviceRequestId, job.serviceRequestId));

        // Enqueue Outbox Notification to Customer
        await enqueueTransactionalNotification(tx, {
          aggregateType: "JOB",
          aggregateId: job.id,
          eventType: "dispatch.technician_reassigned",
          idempotencyKey: `evt:reassign:${job.id}:${now.getTime()}`,
          recipientUserId: job.customerId,
          channel: "SMS",
          destination: job.customerEmail,
          templateSlug: "dispatch.technician_reassigned",
          payload: {
            jobId: job.id,
            technicianName: techDetails?.techName ?? "Certified HVAC Pro",
            contractorName: techDetails?.contractorName ?? "Skilled Hire Partner",
            scheduledStartsAt: newStartsAt.toISOString(),
          },
        });

        return {
          jobId: job.id,
          status: "ASSIGNED",
          technicianId: targetTechId,
          technicianName: techDetails?.techName ?? "Certified Technician",
          contractorId: targetContractorId,
          contractorName: techDetails?.contractorName ?? "Partner Contractor",
          scheduledStartsAt: newStartsAt.toISOString(),
          scheduledEndsAt: newEndsAt.toISOString(),
          exceptionResolved: !!openException,
        };
      });

      await audit(
        currentActor.id,
        "JOB_REASSIGNED",
        "JOB",
        jobId,
        null,
        {
          newTechnicianId: result.technicianId,
          newContractorId: result.contractorId,
        },
      );

      const response: ReassignJobResponse = result;
      return reply.code(200).send(response);
    },
  );

  // -------------------------------------------------------------------------
  // 5. CUSTOMER RECOVERY CHOICE: Customer chooses resolution for stranded job
  // -------------------------------------------------------------------------
  app.post(
    "/v1/jobs/:id/recovery-choice",
    { preHandler: authenticate },
    async (request, reply) => {
      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(customerRecoveryChoiceSchema, request.body);
      const currentActor = actor(request);
      const now = new Date();

      const result = await db.transaction(async (tx) => {
        const [job] = await tx
          .select({
            id: jobs.id,
            status: jobs.status,
            serviceRequestId: jobs.serviceRequestId,
            customerId: serviceRequests.customerId,
            contractorId: jobs.contractorId,
            customerEmail: users.email,
          })
          .from(jobs)
          .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
          .innerJoin(users, eq(users.id, serviceRequests.customerId))
          .where(eq(jobs.id, jobId))
          .for("update", { of: jobs });

        if (!job) {
          const err = new Error("Job not found");
          (err as any).statusCode = 404;
          throw err;
        }

        if (!isOps(currentActor) && job.customerId !== currentActor.id) {
          const err = new Error("Access denied");
          (err as any).statusCode = 403;
          throw err;
        }

        if (body.action === "ACCEPT_REASSIGNMENT") {
          await tx
            .update(jobs)
            .set({ status: "ASSIGNED", updatedAt: now })
            .where(eq(jobs.id, jobId));

          return {
            newJobStatus: "ASSIGNED",
            message: "Reassignment accepted. Your new technician will arrive at the scheduled time.",
          };
        } else if (body.action === "RESCHEDULE_NEW_SLOT") {
          const newStart = body.preferredStartsAt ? new Date(body.preferredStartsAt) : new Date(now.getTime() + 24 * 3600 * 1000);
          const newEnd = body.preferredEndsAt ? new Date(body.preferredEndsAt) : new Date(newStart.getTime() + 2 * 3600 * 1000);

          await tx
            .update(jobs)
            .set({
              status: "SCHEDULED",
              scheduledStartsAt: newStart,
              scheduledEndsAt: newEnd,
              updatedAt: now,
            })
            .where(eq(jobs.id, jobId));

          await tx
            .update(serviceRequests)
            .set({
              preferredStartsAt: newStart,
              preferredEndsAt: newEnd,
              status: "SCHEDULED",
              updatedAt: now,
            })
            .where(eq(serviceRequests.id, job.serviceRequestId));

          return {
            newJobStatus: "SCHEDULED",
            message: `Service rescheduled to ${newStart.toLocaleDateString()}. New slot hold confirmed.`,
          };
        } else {
          // FULL_REFUND_CANCEL
          await tx
            .update(jobs)
            .set({ status: "CANCELLED", updatedAt: now })
            .where(eq(jobs.id, jobId));

          await tx
            .update(serviceRequests)
            .set({ status: "CANCELLED", updatedAt: now })
            .where(eq(serviceRequests.id, job.serviceRequestId));

          // Calculate paid amount to refund
          const paidMilestones = await tx
            .select({ amountCents: paymentMilestones.amountCents })
            .from(paymentMilestones)
            .innerJoin(
              paymentSchedules,
              eq(paymentSchedules.id, paymentMilestones.scheduleId),
            )
            .innerJoin(quotes, eq(quotes.id, paymentSchedules.quoteId))
            .where(
              and(
                eq(quotes.jobId, jobId),
                eq(paymentMilestones.status, "PAID"),
              ),
            );

          const refundAmountCents = paidMilestones.reduce(
            (sum, m) => sum + Number(m.amountCents),
            0,
          );

          await tx.insert(jobCancellations).values({
            jobId: job.id,
            serviceRequestId: job.serviceRequestId,
            cancelledByRole: "CUSTOMER",
            cancelledByUserId: currentActor.id,
            cancellationReason: "TECHNICIAN_NO_SHOW",
            cancellationNotes: body.notes ?? "Customer elected full refund after exception",
            policyApplied: "CONTRACTOR_FAULT_FULL_REFUND_WITH_CREDIT",
            originalAmountPaidCents: refundAmountCents,
            cancellationFeeCents: 0,
            refundAmountCents,
            contractorPayoutCents: 0,
            customerCreditCents: 0,
            contractorPenaltyCents: 0,
          });

          return {
            newJobStatus: "CANCELLED",
            refundAmountCents,
            message: "Job cancelled. 100% full refund has been credited back to your original payment method.",
          };
        }
      });

      await audit(
        currentActor.id,
        "CUSTOMER_RECOVERY_CHOICE_SUBMITTED",
        "JOB",
        jobId,
        null,
        { action: body.action, newJobStatus: result.newJobStatus },
      );

      const response: CustomerRecoveryChoiceResponse = {
        jobId,
        actionTaken: body.action,
        newJobStatus: result.newJobStatus,
        refundAmountCents: result.refundAmountCents,
        message: result.message,
      };

      return reply.code(200).send(response);
    },
  );

  // -------------------------------------------------------------------------
  // 6. DISPATCH EXCEPTIONS QUEUE: Operations review queue with SLA monitor
  // -------------------------------------------------------------------------
  app.get(
    "/v1/dispatch/exceptions",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(
        actor(request),
        "OPERATIONS_AGENT",
        "DISPATCHER",
        "ADMIN",
        "SUPER_ADMIN",
      );

      const now = new Date();

      // Auto-escalate any OPEN exceptions that passed SLA deadline
      await db
        .update(dispatchExceptions)
        .set({ status: "ESCALATED", escalatedAt: now, updatedAt: now })
        .where(
          and(
            eq(dispatchExceptions.status, "OPEN"),
            sql`${dispatchExceptions.slaDeadlineAt} <= ${now}`,
          ),
        );

      // Query exceptions
      const rows = await db
        .select({
          id: dispatchExceptions.id,
          serviceRequestId: dispatchExceptions.serviceRequestId,
          jobId: dispatchExceptions.jobId,
          contractorId: dispatchExceptions.contractorId,
          technicianId: dispatchExceptions.technicianId,
          exceptionType: dispatchExceptions.exceptionType,
          reason: dispatchExceptions.reason,
          notes: dispatchExceptions.notes,
          severity: dispatchExceptions.severity,
          status: dispatchExceptions.status,
          slaDeadlineAt: dispatchExceptions.slaDeadlineAt,
          escalatedAt: dispatchExceptions.escalatedAt,
          resolvedAt: dispatchExceptions.resolvedAt,
          resolvedByUserId: dispatchExceptions.resolvedByUserId,
          resolutionType: dispatchExceptions.resolutionType,
          compensationAmountCents: dispatchExceptions.compensationAmountCents,
          feeAmountCents: dispatchExceptions.feeAmountCents,
          customerCreditCents: dispatchExceptions.customerCreditCents,
          createdAt: dispatchExceptions.createdAt,
          updatedAt: dispatchExceptions.updatedAt,
          urgency: serviceRequests.urgency,
          postalCode: properties.postalCode,
          contractorName: contractors.name,
          technicianName: technicians.displayName,
        })
        .from(dispatchExceptions)
        .innerJoin(serviceRequests, eq(serviceRequests.id, dispatchExceptions.serviceRequestId))
        .innerJoin(properties, eq(properties.id, serviceRequests.propertyId))
        .leftJoin(contractors, eq(contractors.id, dispatchExceptions.contractorId))
        .leftJoin(technicians, eq(technicians.id, dispatchExceptions.technicianId))
        .where(
          inArray(dispatchExceptions.status, ["OPEN", "ESCALATED"]),
        )
        .orderBy(desc(dispatchExceptions.createdAt));

      const exceptions = rows.map((r) => {
        const remainingSeconds = Math.round(
          (r.slaDeadlineAt.getTime() - now.getTime()) / 1000,
        );
        return {
          id: r.id,
          serviceRequestId: r.serviceRequestId,
          jobId: r.jobId,
          contractorId: r.contractorId,
          contractorName: r.contractorName ?? "Unassigned",
          technicianId: r.technicianId,
          technicianName: r.technicianName ?? "Unassigned",
          exceptionType: r.exceptionType as any,
          reason: r.reason,
          notes: r.notes,
          severity: r.severity as any,
          status: r.status as any,
          slaDeadlineAt: r.slaDeadlineAt.toISOString(),
          slaRemainingSeconds: Math.max(0, remainingSeconds),
          isOverdue: remainingSeconds <= 0,
          escalatedAt: r.escalatedAt ? r.escalatedAt.toISOString() : null,
          urgency: r.urgency,
          postalCode: r.postalCode,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        };
      });

      return reply.code(200).send({
        total: exceptions.length,
        openCount: exceptions.filter((e) => e.status === "OPEN").length,
        escalatedCount: exceptions.filter((e) => e.status === "ESCALATED").length,
        exceptions,
      });
    },
  );

  // -------------------------------------------------------------------------
  // 7. RESOLVE EXCEPTION: Ops manual resolution
  // -------------------------------------------------------------------------
  app.post(
    "/v1/dispatch/exceptions/:id/resolve",
    { preHandler: authenticate },
    async (request, reply) => {
      requireRole(
        actor(request),
        "OPERATIONS_AGENT",
        "DISPATCHER",
        "ADMIN",
        "SUPER_ADMIN",
      );
      const exceptionId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(resolveExceptionSchema, request.body);
      const currentActor = actor(request);
      const now = new Date();

      const [updated] = await db
        .update(dispatchExceptions)
        .set({
          status: "RESOLVED",
          resolutionType: body.resolutionType,
          resolvedAt: now,
          resolvedByUserId: currentActor.id,
          notes: body.resolutionNotes ?? "Resolved by Operations Agent",
          compensationAmountCents: body.compensationAmountCents ?? 0,
          updatedAt: now,
        })
        .where(eq(dispatchExceptions.id, exceptionId))
        .returning();

      if (!updated) {
        return reply.code(404).send({ code: "NOT_FOUND", message: "Exception not found" });
      }

      await audit(
        currentActor.id,
        "DISPATCH_EXCEPTION_RESOLVED",
        "DISPATCH_EXCEPTION",
        exceptionId,
        null,
        {
          resolutionType: body.resolutionType,
          resolutionNotes: body.resolutionNotes,
        },
      );

      const response: ResolveExceptionResponse = {
        exception: {
          id: updated.id,
          serviceRequestId: updated.serviceRequestId,
          jobId: updated.jobId,
          contractorId: updated.contractorId,
          technicianId: updated.technicianId,
          exceptionType: updated.exceptionType as any,
          reason: updated.reason,
          notes: updated.notes,
          severity: updated.severity as any,
          status: updated.status as any,
          slaDeadlineAt: updated.slaDeadlineAt.toISOString(),
          escalatedAt: updated.escalatedAt ? updated.escalatedAt.toISOString() : null,
          resolvedAt: updated.resolvedAt ? updated.resolvedAt.toISOString() : null,
          resolvedByUserId: updated.resolvedByUserId,
          resolutionType: updated.resolutionType as any,
          compensationAmountCents: updated.compensationAmountCents,
          feeAmountCents: updated.feeAmountCents,
          customerCreditCents: updated.customerCreditCents,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        },
        resolved: true,
      };

      return reply.code(200).send(response);
    },
  );

  // -------------------------------------------------------------------------
  // 8. CUSTOMER SERVICE CREDITS: Customer wallet balance
  // -------------------------------------------------------------------------
  app.get(
    "/v1/customers/credits",
    { preHandler: authenticate },
    async (request, reply) => {
      const currentActor = actor(request);

      const credits = await db
        .select()
        .from(customerServiceCredits)
        .where(
          and(
            eq(customerServiceCredits.customerId, currentActor.id),
            eq(customerServiceCredits.status, "ACTIVE"),
          ),
        )
        .orderBy(desc(customerServiceCredits.createdAt));

      const totalBalanceCents = credits.reduce(
        (acc, c) => acc + c.balanceCents,
        0,
      );

      return reply.code(200).send({
        customerId: currentActor.id,
        totalBalanceCents,
        totalBalanceDollars: (totalBalanceCents / 100).toFixed(2),
        credits: credits.map((c) => ({
          id: c.id,
          customerId: c.customerId,
          amountCents: c.amountCents,
          balanceCents: c.balanceCents,
          reason: c.reason,
          referenceType: c.referenceType,
          referenceId: c.referenceId,
          expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
          status: c.status,
          createdAt: c.createdAt.toISOString(),
        })),
      });
    },
  );
};
