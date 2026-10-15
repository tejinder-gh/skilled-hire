import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { isStaff } from "@marketplace/auth";
import {
  db,
  eq,
  and,
  sql,
  desc,
  asc,
  inArray,
  transactionalOutbox,
  notificationDeliveryLogs,
  userNotificationPreferences,
  notificationTemplates,
  users,
} from "@marketplace/database";
import {
  SandboxMessagingProvider,
  evaluateAndDispatchOutboxItem,
  type NotificationChannel,
  type NotificationPreferenceCategory,
  type OutboxStatus,
} from "@marketplace/messaging";
import {
  enqueueOutboxNotificationSchema,
  updateNotificationPreferenceSchema,
  workerPollSchema,
} from "@marketplace/validation";
import { actor, authenticate, parse, uuid } from "../common/auth.js";
import { audit } from "../common/events.js";

// Global messaging provider instance for runtime & testing
let globalMessagingProvider = new SandboxMessagingProvider();

export function getMessagingProvider(): SandboxMessagingProvider {
  return globalMessagingProvider;
}

export function setMessagingProvider(provider: SandboxMessagingProvider): void {
  globalMessagingProvider = provider;
}

type DbClientOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Atomic helper to enqueue an outbox notification inside an existing or new database transaction.
 */
export async function enqueueTransactionalNotification(
  client: DbClientOrTx,
  input: {
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    idempotencyKey: string;
    recipientUserId: string;
    channel: NotificationChannel;
    destination: string;
    templateSlug: string;
    templateVersion?: number | undefined;
    payload: Record<string, unknown>;
  },
) {
  const [created] = await client
    .insert(transactionalOutbox)
    .values({
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      eventType: input.eventType,
      idempotencyKey: input.idempotencyKey,
      recipientUserId: input.recipientUserId,
      channel: input.channel,
      destination: input.destination,
      templateSlug: input.templateSlug,
      templateVersion: input.templateVersion ?? 1,
      payload: input.payload,
      status: "PENDING",
      attempts: 0,
      maxAttempts: 5,
    })
    .onConflictDoNothing({ target: transactionalOutbox.idempotencyKey })
    .returning();

  if (!created) {
    // Return existing record if deduplicated
    const [existing] = await client
      .select()
      .from(transactionalOutbox)
      .where(eq(transactionalOutbox.idempotencyKey, input.idempotencyKey))
      .limit(1);
    return existing;
  }

  return created;
}

export const notificationsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /v1/notifications/outbox
   * Query outbox records with filtering by status and recipient.
   */
  app.get(
    "/v1/notifications/outbox",
    { preHandler: [authenticate] },
    async (req, reply) => {
      const currentActor = actor(req);
      const query = parse(
        z.object({
          status: z.enum([
            "PENDING",
            "PROCESSING",
            "DELIVERED",
            "RETRYING",
            "DEAD_LETTER",
            "CANCELLED_PREFERENCE",
            "ALL",
          ]).default("ALL"),
          recipientUserId: uuid.optional(),
          aggregateId: uuid.optional(),
          limit: z.coerce.number().min(1).max(100).default(50),
          offset: z.coerce.number().min(0).default(0),
        }),
        req.query,
      );

      // Staff can query any recipient; non-staff can only query their own notifications
      const targetUserId = isStaff(currentActor)
        ? query.recipientUserId
        : currentActor.id;

      const conditions = [];
      if (
        query.status === "PENDING" ||
        query.status === "PROCESSING" ||
        query.status === "DELIVERED" ||
        query.status === "RETRYING" ||
        query.status === "DEAD_LETTER" ||
        query.status === "CANCELLED_PREFERENCE"
      ) {
        conditions.push(eq(transactionalOutbox.status, query.status));
      }
      if (targetUserId) {
        conditions.push(eq(transactionalOutbox.recipientUserId, targetUserId));
      }
      if (query.aggregateId) {
        conditions.push(eq(transactionalOutbox.aggregateId, query.aggregateId));
      }

      const items = await db
        .select()
        .from(transactionalOutbox)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(transactionalOutbox.createdAt))
        .limit(query.limit ?? 50)
        .offset(query.offset ?? 0);

      return reply.send({
        outbox: items.map((i) => ({
          ...i,
          createdAt: i.createdAt.toISOString(),
          updatedAt: i.updatedAt.toISOString(),
          nextAttemptAt: i.nextAttemptAt.toISOString(),
          lockedAt: i.lockedAt?.toISOString() ?? null,
          deliveredAt: i.deliveredAt?.toISOString() ?? null,
        })),
        count: items.length,
      });
    },
  );

  /**
   * POST /v1/notifications/outbox
   * Enqueue a new notification into the transactional outbox.
   */
  app.post(
    "/v1/notifications/outbox",
    { preHandler: [authenticate] },
    async (req, reply) => {
      const currentActor = actor(req);
      const body = parse(enqueueOutboxNotificationSchema, req.body);

      // Verify authorization: Staff or dispatching to self
      if (!isStaff(currentActor) && currentActor.id !== body.recipientUserId) {
        return reply.status(403).send({
          statusCode: 403,
          error: "FORBIDDEN",
          message: "Not authorized to enqueue notification for another user",
        });
      }

      const item = await enqueueTransactionalNotification(db, {
        aggregateType: body.aggregateType,
        aggregateId: body.aggregateId,
        eventType: body.eventType,
        idempotencyKey: body.idempotencyKey,
        recipientUserId: body.recipientUserId,
        channel: body.channel,
        destination: body.destination,
        templateSlug: body.templateSlug,
        templateVersion: body.templateVersion,
        payload: body.payload ?? {},
      });

      if (!item) {
        return reply.status(500).send({
          statusCode: 500,
          error: "OUTBOX_ERROR",
          message: "Failed to enqueue notification in transactional outbox",
        });
      }

      return reply.status(201).send({
        outboxItem: {
          ...item,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
          nextAttemptAt: item.nextAttemptAt.toISOString(),
        },
      });
    },
  );

  /**
   * POST /v1/notifications/outbox/:id/retry
   * Operations manual retry for dead-lettered or stalled outbox notifications.
   */
  app.post(
    "/v1/notifications/outbox/:id/retry",
    { preHandler: [authenticate] },
    async (req, reply) => {
      const currentActor = actor(req);
      if (!isStaff(currentActor)) {
        return reply.status(403).send({
          statusCode: 403,
          error: "FORBIDDEN",
          message: "Only operations staff may trigger manual outbox retries",
        });
      }

      const { id } = parse(z.object({ id: uuid }), req.params);

      const [item] = await db
        .select()
        .from(transactionalOutbox)
        .where(eq(transactionalOutbox.id, id))
        .limit(1);

      if (!item) {
        return reply.status(404).send({
          statusCode: 404,
          error: "NOT_FOUND",
          message: "Outbox item not found",
        });
      }

      const [updated] = await db
        .update(transactionalOutbox)
        .set({
          status: "PENDING",
          nextAttemptAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          updatedAt: new Date(),
        })
        .where(eq(transactionalOutbox.id, id))
        .returning();

      if (!updated) {
        return reply.status(500).send({
          statusCode: 500,
          error: "UPDATE_FAILED",
          message: "Failed to reset outbox retry status",
        });
      }

      await audit(
        currentActor.id,
        "OUTBOX_MANUAL_RETRY_TRIGGERED",
        "transactional_outbox",
        id,
        { status: item.status },
        { status: "PENDING" },
        { previousAttempts: item.attempts },
      );

      return reply.send({
        message: "Notification reset to PENDING for immediate retry sweep",
        outboxItem: {
          ...updated,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
          nextAttemptAt: updated.nextAttemptAt.toISOString(),
        },
      });
    },
  );

  /**
   * POST /v1/notifications/worker/poll
   * Transactional outbox worker polling sweep.
   * Atomically claims candidate items with lease lock, delivers via provider adapter,
   * updates status/backoff, and records immutable delivery audit logs.
   */
  app.post(
    "/v1/notifications/worker/poll",
    { preHandler: [authenticate] },
    async (req, reply) => {
      const currentActor = actor(req);
      if (!isStaff(currentActor)) {
        return reply.status(403).send({
          statusCode: 403,
          error: "FORBIDDEN",
          message: "Only staff / worker agents may execute outbox poll sweeps",
        });
      }

      const body = parse(workerPollSchema, req.body ?? {});
      const workerId = body.workerId ?? `worker-${Date.now()}`;
      const batchSize = body.batchSize;
      const startTime = Date.now();

      // 1. Claim batch of PENDING/RETRYING items where next_attempt_at <= NOW
      // Stale locks older than 5 minutes are reclaimable
      const staleLockThreshold = new Date(Date.now() - 5 * 60 * 1000);

      const candidateItems = await db
        .select()
        .from(transactionalOutbox)
        .where(
          and(
            inArray(transactionalOutbox.status, ["PENDING", "RETRYING"]),
            sql`${transactionalOutbox.nextAttemptAt} <= NOW()`,
            sql`(${transactionalOutbox.lockedAt} IS NULL OR ${transactionalOutbox.lockedAt} < ${staleLockThreshold})`,
          ),
        )
        .orderBy(asc(transactionalOutbox.nextAttemptAt))
        .limit(batchSize ?? 20);

      if (candidateItems.length === 0) {
        return reply.send({
          claimedCount: 0,
          deliveredCount: 0,
          retriedCount: 0,
          deadLetterCount: 0,
          cancelledCount: 0,
          durationMs: Date.now() - startTime,
          processedIds: [],
        });
      }

      const claimedIds = candidateItems.map((c) => c.id);

      // Atomic lease acquisition
      await db
        .update(transactionalOutbox)
        .set({
          status: "PROCESSING",
          lockedAt: new Date(),
          lockedBy: workerId,
          updatedAt: new Date(),
        })
        .where(inArray(transactionalOutbox.id, claimedIds));

      let deliveredCount = 0;
      let retriedCount = 0;
      let deadLetterCount = 0;
      let cancelledCount = 0;
      const processedIds: string[] = [];

      // 2. Process each claimed item
      for (const item of candidateItems) {
        // Find user preference for this category/channel
        const [userPref] = await db
          .select()
          .from(userNotificationPreferences)
          .where(
            and(
              eq(userNotificationPreferences.userId, item.recipientUserId),
              eq(userNotificationPreferences.channel, item.channel),
            ),
          )
          .limit(1);

        // Find optional custom template from database
        const [dbTemplate] = await db
          .select()
          .from(notificationTemplates)
          .where(
            and(
              eq(notificationTemplates.templateSlug, item.templateSlug),
              eq(notificationTemplates.version, item.templateVersion),
              eq(notificationTemplates.channel, item.channel),
              eq(notificationTemplates.isActive, true),
            ),
          )
          .limit(1);

        const evalOutput = await evaluateAndDispatchOutboxItem(
          {
            item: {
              ...item,
              channel: item.channel,
              status: item.status,
              payload: (item.payload as Record<string, unknown>) ?? {},
              nextAttemptAt: item.nextAttemptAt.toISOString(),
            },
            userPreference: userPref
              ? {
                  category: userPref.category,
                  enabled: userPref.enabled,
                }
              : undefined,
            customTemplate: dbTemplate
              ? {
                  subjectTemplate: dbTemplate.subjectTemplate,
                  bodyTemplate: dbTemplate.bodyTemplate,
                }
              : undefined,
          },
          globalMessagingProvider,
        );

        // Save delivery log and update outbox atomically
        await db.transaction(async (tx) => {
          if (evalOutput.deliveryLog) {
            await tx.insert(notificationDeliveryLogs).values({
              outboxId: item.id,
              channel: evalOutput.deliveryLog.channel,
              recipient: evalOutput.deliveryLog.recipient,
              providerName: evalOutput.deliveryLog.providerName,
              providerMessageId: evalOutput.deliveryLog.providerMessageId ?? null,
              attemptNumber: evalOutput.deliveryLog.attemptNumber,
              durationMs: evalOutput.deliveryLog.durationMs,
              status: evalOutput.deliveryLog.status,
              responsePayload: evalOutput.deliveryLog.responsePayload ?? {},
              errorCode: evalOutput.deliveryLog.errorCode ?? null,
              errorMessage: evalOutput.deliveryLog.errorMessage ?? null,
            });
          }

          await tx
            .update(transactionalOutbox)
            .set({
              status: evalOutput.newStatus,
              attempts: evalOutput.newAttempts,
              nextAttemptAt: new Date(evalOutput.nextAttemptAt),
              deliveredAt: evalOutput.deliveredAt
                ? new Date(evalOutput.deliveredAt)
                : null,
              lastError: evalOutput.lastError ?? null,
              lockedAt: null,
              lockedBy: null,
              updatedAt: new Date(),
            })
            .where(eq(transactionalOutbox.id, item.id));
        });

        processedIds.push(item.id);
        if (evalOutput.newStatus === "DELIVERED") deliveredCount++;
        else if (evalOutput.newStatus === "RETRYING") retriedCount++;
        else if (evalOutput.newStatus === "DEAD_LETTER") deadLetterCount++;
        else if (evalOutput.newStatus === "CANCELLED_PREFERENCE") cancelledCount++;
      }

      return reply.send({
        claimedCount: candidateItems.length,
        deliveredCount,
        retriedCount,
        deadLetterCount,
        cancelledCount,
        durationMs: Date.now() - startTime,
        processedIds,
      });
    },
  );

  /**
   * GET /v1/notifications/preferences
   * List notification preferences for current user (or target user if staff).
   */
  app.get(
    "/v1/notifications/preferences",
    { preHandler: [authenticate] },
    async (req, reply) => {
      const currentActor = actor(req);
      const query = parse(
        z.object({
          userId: uuid.optional(),
        }),
        req.query,
      );

      const targetUserId = isStaff(currentActor) && query.userId
        ? query.userId
        : currentActor.id;

      const prefs = await db
        .select()
        .from(userNotificationPreferences)
        .where(eq(userNotificationPreferences.userId, targetUserId));

      return reply.send({
        userId: targetUserId,
        preferences: prefs.map((p) => ({
          ...p,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
          optedOutAt: p.optedOutAt?.toISOString() ?? null,
        })),
      });
    },
  );

  /**
   * PUT /v1/notifications/preferences
   * Update notification preference (opt-in / opt-out).
   */
  app.put(
    "/v1/notifications/preferences",
    { preHandler: [authenticate] },
    async (req, reply) => {
      const currentActor = actor(req);
      const body = parse(updateNotificationPreferenceSchema, req.body);
      const targetUserId = currentActor.id;

      // Statutory receipts and emergency communications cannot be opted out
      if (
        (!body.enabled) &&
        (body.category === "SAFETY_EMERGENCY" || body.category === "TRANSACTIONAL_RECEIPTS")
      ) {
        return reply.status(400).send({
          statusCode: 400,
          error: "REGULATORY_RESTRICTION",
          message:
            "Under Ontario consumer protection and safety regulations, safety emergency notifications and transactional receipts cannot be opted out.",
        });
      }

      const optedOutAt = body.enabled ? null : new Date();

      const [pref] = await db
        .insert(userNotificationPreferences)
        .values({
          userId: targetUserId,
          channel: body.channel,
          category: body.category,
          enabled: body.enabled,
          optedOutAt,
          optInSource: "USER_SETTINGS_PORTAL",
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            userNotificationPreferences.userId,
            userNotificationPreferences.channel,
            userNotificationPreferences.category,
          ],
          set: {
            enabled: body.enabled,
            optedOutAt,
            updatedAt: new Date(),
          },
        })
        .returning();

      return reply.send({
        preference: {
          ...pref,
          createdAt: pref?.createdAt.toISOString(),
          updatedAt: pref?.updatedAt.toISOString(),
          optedOutAt: pref?.optedOutAt?.toISOString() ?? null,
        },
      });
    },
  );

  /**
   * GET /v1/notifications/delivery-logs
   * View immutable delivery audit logs for operations tracking.
   */
  app.get(
    "/v1/notifications/delivery-logs",
    { preHandler: [authenticate] },
    async (req, reply) => {
      const currentActor = actor(req);
      if (!isStaff(currentActor)) {
        return reply.status(403).send({
          statusCode: 403,
          error: "FORBIDDEN",
          message: "Only staff can inspect delivery audit logs",
        });
      }

      const query = parse(
        z.object({
          outboxId: uuid.optional(),
          status: z.string().optional(),
          limit: z.coerce.number().min(1).max(100).default(50),
          offset: z.coerce.number().min(0).default(0),
        }),
        req.query,
      );

      const conditions = [];
      if (query.outboxId) {
        conditions.push(eq(notificationDeliveryLogs.outboxId, query.outboxId));
      }
      if (query.status) {
        conditions.push(eq(notificationDeliveryLogs.status, query.status));
      }

      const logs = await db
        .select()
        .from(notificationDeliveryLogs)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(notificationDeliveryLogs.createdAt))
        .limit(query.limit ?? 50)
        .offset(query.offset ?? 0);

      return reply.send({
        deliveryLogs: logs.map((l) => ({
          ...l,
          createdAt: l.createdAt.toISOString(),
        })),
        count: logs.length,
      });
    },
  );
};
