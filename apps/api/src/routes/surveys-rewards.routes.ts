// apps/api/src/routes/surveys-rewards.routes.ts

import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  db,
  eq,
  and,
  desc,
  jobs,
  serviceRequests,
  quotes,
  reviews,
  supportTickets,
  processedWebhooks,
  customerFeedbackPreferences,
  postJobSurveys,
  customerRewardCredits,
} from "@marketplace/database";
import {
  updateCustomerFeedbackPreferencesSchema,
  createSurveyInvitationSchema,
  submitPostJobSurveySchema,
  redeemRewardCreditSchema,
  surveyWebhookPayloadSchema,
} from "@marketplace/validation";
import {
  generateSurveyToken,
  calculateNextServiceCredit,
  isNegativeReviewDissatisfied,
  validateFairReviewCompliance,
  computeSurveyConversionAnalytics,
} from "@marketplace/vertical-engine";
import type {
  CustomerFeedbackPreferences,
  PostJobSurvey,
  CustomerRewardCredit,
} from "@marketplace/contracts";
import { actor, authenticate, isOps, parse, uuid } from "../common/auth.js";
import { audit, emit } from "../common/events.js";

function mapPreferences(
  row: typeof customerFeedbackPreferences.$inferSelect,
): CustomerFeedbackPreferences {
  return {
    id: row.id,
    customerId: row.customerId,
    feedbackOptIn: row.feedbackOptIn,
    smsOptIn: row.smsOptIn,
    emailOptIn: row.emailOptIn,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapSurvey(row: typeof postJobSurveys.$inferSelect): PostJobSurvey {
  return {
    id: row.id,
    jobId: row.jobId,
    customerId: row.customerId,
    contractorId: row.contractorId,
    surveyToken: row.surveyToken,
    status: row.status as PostJobSurvey["status"],
    channel: row.channel as PostJobSurvey["channel"],
    overallRating: row.overallRating ?? undefined,
    qualityRating: row.qualityRating ?? undefined,
    professionalismRating: row.professionalismRating ?? undefined,
    timelinessRating: row.timelinessRating ?? undefined,
    communicationRating: row.communicationRating ?? undefined,
    npsScore: row.npsScore ?? undefined,
    feedbackComment: row.feedbackComment ?? undefined,
    reviewId: row.reviewId ?? undefined,
    routedToSupport: row.routedToSupport,
    supportTicketId: row.supportTicketId ?? undefined,
    sentAt: row.sentAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : undefined,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

function mapCredit(
  row: typeof customerRewardCredits.$inferSelect,
): CustomerRewardCredit {
  return {
    id: row.id,
    customerId: row.customerId,
    originJobId: row.originJobId,
    surveyId: row.surveyId,
    rewardType: row.rewardType,
    amountCents: row.amountCents,
    balanceCents: row.balanceCents,
    capCents: row.capCents,
    percentageBps: row.percentageBps,
    status: row.status as CustomerRewardCredit["status"],
    expiresAt: row.expiresAt.toISOString(),
    redeemedAt: row.redeemedAt ? row.redeemedAt.toISOString() : undefined,
    redeemedJobId: row.redeemedJobId ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

export const surveysRewardsRoutes: FastifyPluginAsync = async (app) => {
  // GET /v1/customers/feedback-preferences - View feedback preferences
  app.get(
    "/v1/customers/feedback-preferences",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);

      const [prefs] = await db
        .select()
        .from(customerFeedbackPreferences)
        .where(eq(customerFeedbackPreferences.customerId, user.id))
        .limit(1);

      if (!prefs) {
        // Return default opt-in preference
        return reply.send({
          id: user.id,
          customerId: user.id,
          feedbackOptIn: true,
          smsOptIn: false,
          emailOptIn: true,
          updatedAt: new Date().toISOString(),
        });
      }

      return reply.send(mapPreferences(prefs));
    },
  );

  // PUT /v1/customers/feedback-preferences - Update feedback preferences (opt in / opt out)
  app.put(
    "/v1/customers/feedback-preferences",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const body = parse(updateCustomerFeedbackPreferencesSchema, request.body);

      const [existing] = await db
        .select()
        .from(customerFeedbackPreferences)
        .where(eq(customerFeedbackPreferences.customerId, user.id))
        .limit(1);

      if (existing) {
        const [updated] = await db
          .update(customerFeedbackPreferences)
          .set({
            feedbackOptIn: body.feedbackOptIn ?? existing.feedbackOptIn,
            smsOptIn: body.smsOptIn ?? existing.smsOptIn,
            emailOptIn: body.emailOptIn ?? existing.emailOptIn,
            updatedAt: new Date(),
          })
          .where(eq(customerFeedbackPreferences.id, existing.id))
          .returning();

        return reply.send(mapPreferences(updated!));
      }

      const [created] = await db
        .insert(customerFeedbackPreferences)
        .values({
          customerId: user.id,
          feedbackOptIn: body.feedbackOptIn ?? true,
          smsOptIn: body.smsOptIn ?? false,
          emailOptIn: body.emailOptIn ?? true,
        })
        .returning();

      return reply.code(200).send(mapPreferences(created!));
    },
  );

  // POST /v1/jobs/:id/survey-invitation - Create/dispatch post-job survey invitation
  app.post(
    "/v1/jobs/:id/survey-invitation",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(createSurveyInvitationSchema.partial(), request.body ?? {});

      const [jobRow] = await db
        .select({
          id: jobs.id,
          contractorId: jobs.contractorId,
          status: jobs.status,
          customerId: serviceRequests.customerId,
        })
        .from(jobs)
        .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (!jobRow) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      // Check existing survey for idempotency
      const [existingSurvey] = await db
        .select()
        .from(postJobSurveys)
        .where(eq(postJobSurveys.jobId, jobId))
        .limit(1);

      if (existingSurvey) {
        return reply.code(200).send(mapSurvey(existingSurvey));
      }

      // Check customer opt-in preferences
      const [prefs] = await db
        .select()
        .from(customerFeedbackPreferences)
        .where(eq(customerFeedbackPreferences.customerId, jobRow.customerId))
        .limit(1);

      if (prefs && !prefs.feedbackOptIn) {
        return reply.code(200).send({
          optedOut: true,
          message: "Customer has opted out of post-service feedback requests",
        });
      }

      const surveyToken = generateSurveyToken();
      const expiresInDays = body.expiresInDays ?? 14;
      const expiresAt = new Date(Date.now() + expiresInDays * 24 * 3600 * 1000);

      const [newSurvey] = await db
        .insert(postJobSurveys)
        .values({
          jobId: jobRow.id,
          customerId: jobRow.customerId,
          contractorId: jobRow.contractorId,
          surveyToken,
          status: "PENDING",
          channel: body.channel ?? "EMAIL",
          expiresAt,
        })
        .returning();

      if (!newSurvey) {
        return reply.code(500).send({
          statusCode: 500,
          code: "INTERNAL_ERROR",
          message: "Failed to create survey invitation",
        });
      }

      await audit(user.id, "survey_invitation.created", "post_job_survey", newSurvey.id, null, newSurvey);
      await emit("post_job_survey", newSurvey.id, "survey.dispatched", {
        jobId: jobRow.id,
        customerId: jobRow.customerId,
        surveyToken,
      });

      return reply.code(201).send(mapSurvey(newSurvey));
    },
  );

  // GET /v1/surveys/:token - Fetch survey invitation details by token
  app.get("/v1/surveys/:token", async (request, reply) => {
    const token = parse(z.object({ token: z.string().min(3) }), request.params).token;

    const [survey] = await db
      .select()
      .from(postJobSurveys)
      .where(eq(postJobSurveys.surveyToken, token))
      .limit(1);

    if (!survey) {
      return reply.code(404).send({
        statusCode: 404,
        code: "NOT_FOUND",
        message: "Survey invitation not found",
      });
    }

    return reply.send(mapSurvey(survey));
  });

  // POST /v1/surveys/:token/submit - Submit survey, create review, and award 10% credit
  app.post("/v1/surveys/:token/submit", async (request, reply) => {
    const token = parse(z.object({ token: z.string().min(3) }), request.params).token;
    const body = parse(submitPostJobSurveySchema, request.body);

    const [survey] = await db
      .select()
      .from(postJobSurveys)
      .where(eq(postJobSurveys.surveyToken, token))
      .limit(1);

    if (!survey) {
      return reply.code(404).send({
        statusCode: 404,
        code: "NOT_FOUND",
        message: "Survey invitation not found",
      });
    }

    if (survey.status === "COMPLETED") {
      return reply.code(409).send({
        statusCode: 409,
        code: "ALREADY_COMPLETED",
        message: "This survey has already been submitted",
      });
    }

    // Check negative review / customer dissatisfaction
    const dissatisfactionCheck = isNegativeReviewDissatisfied({
      overallRating: body.overallRating,
      npsScore: body.npsScore,
      feedbackComment: body.feedbackComment,
    });

    let supportTicketId: string | null = null;
    if (dissatisfactionCheck.isNegative) {
      const [ticket] = await db
        .insert(supportTickets)
        .values({
          customerId: survey.customerId,
          contractorId: survey.contractorId,
          jobId: survey.jobId,
          subject: `Automated Post-Job Feedback Escalation (${body.overallRating}★)`,
          description: `Customer submitted dissatisfied feedback: "${body.feedbackComment ?? "No comment"}". Triage Reason: ${dissatisfactionCheck.reason}`,
          status: "OPEN",
        })
        .returning();
      supportTicketId = ticket?.id ?? null;
    }

    // Upsert public review if requested
    let reviewId: string | null = null;
    if (body.shareAsPublicReview) {
      const [createdReview] = await db
        .insert(reviews)
        .values({
          jobId: survey.jobId,
          customerId: survey.customerId,
          overall: body.overallRating,
          quality: body.qualityRating ?? null,
          professionalism: body.professionalismRating ?? null,
          timeliness: body.timelinessRating ?? null,
          communication: body.communicationRating ?? null,
          comment: body.feedbackComment ?? null,
        })
        .onConflictDoNothing({ target: reviews.jobId })
        .returning({ id: reviews.id });

      reviewId = createdReview?.id ?? null;
    }

    // Calculate 10% credit reward (cap $30 / 3000 cents)
    const [quote] = await db
      .select({ customerTotalCents: quotes.customerTotalCents })
      .from(quotes)
      .where(and(eq(quotes.jobId, survey.jobId), eq(quotes.status, "ACCEPTED")))
      .limit(1);

    const jobTotalCents = quote ? Number(quote.customerTotalCents) : 25000;
    const creditCalc = calculateNextServiceCredit(jobTotalCents);

    // Verify fair review compliance: reward must be granted regardless of score
    const fairness = validateFairReviewCompliance({
      overallRating: body.overallRating,
      rewardEarned: true,
    });
    if (!fairness.compliant) {
      throw new Error(fairness.error);
    }

    const rewardExpiresAt = new Date(Date.now() + 90 * 24 * 3600 * 1000); // 90 days validity

    const [reward] = await db
      .insert(customerRewardCredits)
      .values({
        customerId: survey.customerId,
        originJobId: survey.jobId,
        surveyId: survey.id,
        rewardType: "POST_JOB_SURVEY_10_PERCENT",
        amountCents: creditCalc.creditAmountCents,
        balanceCents: creditCalc.creditAmountCents,
        capCents: creditCalc.capCents,
        percentageBps: creditCalc.percentageBps,
        status: "ACTIVE",
        expiresAt: rewardExpiresAt,
      })
      .returning();

    // Update survey record
    const [updatedSurvey] = await db
      .update(postJobSurveys)
      .set({
        status: "COMPLETED",
        overallRating: body.overallRating,
        qualityRating: body.qualityRating ?? null,
        professionalismRating: body.professionalismRating ?? null,
        timelinessRating: body.timelinessRating ?? null,
        communicationRating: body.communicationRating ?? null,
        npsScore: body.npsScore ?? null,
        feedbackComment: body.feedbackComment ?? null,
        reviewId,
        routedToSupport: dissatisfactionCheck.isNegative,
        supportTicketId,
        completedAt: new Date(),
      })
      .where(eq(postJobSurveys.id, survey.id))
      .returning();

    await audit(survey.customerId, "survey.submitted", "post_job_survey", survey.id, null, updatedSurvey);
    await emit("post_job_survey", survey.id, "survey.completed", {
      overallRating: body.overallRating,
      routedToSupport: dissatisfactionCheck.isNegative,
      rewardCreditCents: creditCalc.creditAmountCents,
    });

    return reply.code(200).send({
      survey: mapSurvey(updatedSurvey!),
      rewardCredit: mapCredit(reward!),
      routedToSupport: dissatisfactionCheck.isNegative,
      supportTicketId,
    });
  });

  // GET /v1/customers/me/rewards - Customer views reward credits
  app.get(
    "/v1/customers/me/rewards",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);

      const rows = await db
        .select()
        .from(customerRewardCredits)
        .where(eq(customerRewardCredits.customerId, user.id))
        .orderBy(desc(customerRewardCredits.createdAt));

      return reply.send(rows.map(mapCredit));
    },
  );

  // POST /v1/rewards/redeem - Redeem active credit on next booking
  app.post(
    "/v1/rewards/redeem",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      const body = parse(redeemRewardCreditSchema, request.body);

      const [credit] = await db
        .select()
        .from(customerRewardCredits)
        .where(eq(customerRewardCredits.id, body.creditId))
        .limit(1);

      if (!credit) {
        return reply.code(404).send({
          statusCode: 404,
          code: "NOT_FOUND",
          message: "Reward credit not found",
        });
      }

      if (credit.customerId !== user.id && !isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Not authorized to redeem this credit",
        });
      }

      if (credit.status !== "ACTIVE" || credit.balanceCents <= 0) {
        return reply.code(400).send({
          statusCode: 400,
          code: "CREDIT_UNAVAILABLE",
          message: "Credit is already redeemed, expired, or voided",
        });
      }

      if (new Date(credit.expiresAt) < new Date()) {
        await db
          .update(customerRewardCredits)
          .set({ status: "EXPIRED" })
          .where(eq(customerRewardCredits.id, credit.id));

        return reply.code(400).send({
          statusCode: 400,
          code: "CREDIT_EXPIRED",
          message: "Reward credit has expired",
        });
      }

      const redeemAmount = body.amountCents
        ? Math.min(credit.balanceCents, body.amountCents)
        : credit.balanceCents;

      const newBalance = credit.balanceCents - redeemAmount;
      const nextStatus = newBalance === 0 ? "REDEEMED" : "ACTIVE";

      const [updated] = await db
        .update(customerRewardCredits)
        .set({
          balanceCents: newBalance,
          status: nextStatus,
          redeemedAt: new Date(),
          redeemedJobId: body.jobId,
        })
        .where(eq(customerRewardCredits.id, credit.id))
        .returning();

      await audit(user.id, "reward_credit.redeemed", "customer_reward_credit", credit.id, credit, updated);

      return reply.code(200).send(mapCredit(updated!));
    },
  );

  // POST /v1/webhooks/surveys - Idempotent external survey webhook
  app.post("/v1/webhooks/surveys", async (request, reply) => {
    const body = parse(surveyWebhookPayloadSchema, request.body);

    if (body.externalSubmissionId) {
      const [existing] = await db
        .select()
        .from(processedWebhooks)
        .where(
          and(
            eq(processedWebhooks.provider, "SURVEY_WEBHOOK"),
            eq(processedWebhooks.eventId, body.externalSubmissionId),
          ),
        )
        .limit(1);

      if (existing) {
        return reply.code(200).send({
          idempotent: true,
          message: "Webhook submission already processed",
        });
      }

      await db.insert(processedWebhooks).values({
        provider: "SURVEY_WEBHOOK",
        eventId: body.externalSubmissionId,
      });
    }

    const [survey] = await db
      .select()
      .from(postJobSurveys)
      .where(eq(postJobSurveys.surveyToken, body.surveyToken))
      .limit(1);

    if (!survey) {
      return reply.code(404).send({
        statusCode: 404,
        code: "NOT_FOUND",
        message: "Survey not found for token",
      });
    }

    if (survey.status === "COMPLETED") {
      return reply.code(200).send({
        idempotent: true,
        message: "Survey already completed",
        survey: mapSurvey(survey),
      });
    }

    const dissatisfactionCheck = isNegativeReviewDissatisfied({
      overallRating: body.overallRating,
      npsScore: body.npsScore,
      feedbackComment: body.feedbackComment,
    });

    let supportTicketId: string | null = null;
    if (dissatisfactionCheck.isNegative) {
      const [ticket] = await db
        .insert(supportTickets)
        .values({
          customerId: survey.customerId,
          contractorId: survey.contractorId,
          jobId: survey.jobId,
          subject: `Automated Survey Webhook Escalation (${body.overallRating}★)`,
          description: `Customer submitted dissatisfied feedback via webhook: "${body.feedbackComment ?? "No comment"}"`,
          status: "OPEN",
        })
        .returning();
      supportTicketId = ticket?.id ?? null;
    }

    const [quote] = await db
      .select({ customerTotalCents: quotes.customerTotalCents })
      .from(quotes)
      .where(and(eq(quotes.jobId, survey.jobId), eq(quotes.status, "ACCEPTED")))
      .limit(1);

    const creditCalc = calculateNextServiceCredit(quote ? Number(quote.customerTotalCents) : 25000);
    const rewardExpiresAt = new Date(Date.now() + 90 * 24 * 3600 * 1000);

    const [reward] = await db
      .insert(customerRewardCredits)
      .values({
        customerId: survey.customerId,
        originJobId: survey.jobId,
        surveyId: survey.id,
        rewardType: "POST_JOB_SURVEY_10_PERCENT",
        amountCents: creditCalc.creditAmountCents,
        balanceCents: creditCalc.creditAmountCents,
        capCents: creditCalc.capCents,
        percentageBps: creditCalc.percentageBps,
        status: "ACTIVE",
        expiresAt: rewardExpiresAt,
      })
      .returning();

    const [updatedSurvey] = await db
      .update(postJobSurveys)
      .set({
        status: "COMPLETED",
        overallRating: body.overallRating,
        qualityRating: body.qualityRating ?? null,
        professionalismRating: body.professionalismRating ?? null,
        timelinessRating: body.timelinessRating ?? null,
        communicationRating: body.communicationRating ?? null,
        npsScore: body.npsScore ?? null,
        feedbackComment: body.feedbackComment ?? null,
        routedToSupport: dissatisfactionCheck.isNegative,
        supportTicketId,
        completedAt: new Date(),
      })
      .where(eq(postJobSurveys.id, survey.id))
      .returning();

    return reply.code(200).send({
      survey: mapSurvey(updatedSurvey!),
      rewardCredit: mapCredit(reward!),
      routedToSupport: dissatisfactionCheck.isNegative,
    });
  });

  // GET /v1/analytics/surveys - Survey conversion & reward analytics (Ops only)
  app.get(
    "/v1/analytics/surveys",
    { preHandler: authenticate },
    async (request, reply) => {
      const user = actor(request);
      if (!isOps(user)) {
        return reply.code(403).send({
          statusCode: 403,
          code: "FORBIDDEN",
          message: "Only operations can view survey analytics",
        });
      }

      const allSurveys = await db.select().from(postJobSurveys);
      const allCredits = await db.select().from(customerRewardCredits);

      const analytics = computeSurveyConversionAnalytics(
        allSurveys.map((s) => ({
          status: s.status,
          overallRating: s.overallRating,
          routedToSupport: s.routedToSupport,
        })),
        allCredits.map((c) => ({
          amountCents: c.amountCents,
          balanceCents: c.balanceCents,
          status: c.status,
        })),
      );

      return reply.send(analytics);
    },
  );
};
