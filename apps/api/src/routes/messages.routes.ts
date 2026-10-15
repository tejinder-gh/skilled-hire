import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  EMERGENCY_SAFETY_DESK_PHONE,
  MASKED_COMMUNICATIONS_CONSENT,
  type MessageDTO,
  type Role,
} from "@marketplace/contracts";
import {
  generateMaskedSessionIdentifiers,
  maskPhoneNumber,
  screenMessageContent,
} from "@marketplace/core";
import {
  db,
  eq,
  and,
  sql,
  desc,
  jobs,
  technicians,
  contractors,
  serviceRequests,
  users,
  jobConversations,
  jobMessages,
  maskedCommunicationSessions,
  contractorSafetyQuarantines,
} from "@marketplace/database";
import {
  sendMessageSchema,
  markMessagesReadSchema,
} from "@marketplace/validation";
import { actor, authenticate, isOps, parse, uuid } from "../common/auth.js";
import { audit, notify } from "../common/events.js";

export const messagesRoutes: FastifyPluginAsync = async (app) => {
  // ---------------------------------------------------------------------------
  // 1. Get or Initialize Conversation & Message History (Job-Scoped)
  // ---------------------------------------------------------------------------
  app.get(
    "/v1/jobs/:id/conversation",
    { preHandler: authenticate },
    async (request, reply) => {
      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const currentActor = actor(request);

      const [jobContext] = await db
        .select({
          jobId: jobs.id,
          jobStatus: jobs.status,
          contractorId: jobs.contractorId,
          serviceRequestId: jobs.serviceRequestId,
          customerId: serviceRequests.customerId,
          customerName: users.displayName,
          technicianId: technicians.id,
          technicianUserId: technicians.userId,
          technicianName: technicians.displayName,
          contractorOwnerUserId: contractors.ownerUserId,
        })
        .from(jobs)
        .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
        .innerJoin(users, eq(users.id, serviceRequests.customerId))
        .innerJoin(technicians, eq(technicians.id, jobs.technicianId))
        .innerJoin(contractors, eq(contractors.id, jobs.contractorId))
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (!jobContext) {
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "Job not found" });
      }

      // Authorization guard: customer, assigned tech, contractor owner, or ops
      const isCustomer = jobContext.customerId === currentActor.id;
      const isTech = jobContext.technicianUserId === currentActor.id;
      const isContractor =
        jobContext.contractorOwnerUserId === currentActor.id ||
        jobContext.contractorId === currentActor.contractorId;
      const isStaff = isOps(currentActor);

      if (!isCustomer && !isTech && !isContractor && !isStaff) {
        return reply.code(403).send({
          code: "FORBIDDEN",
          message: "You are not an authorized participant of this job conversation",
        });
      }

      // Ensure job_conversations record exists
      let [conversation] = await db
        .select()
        .from(jobConversations)
        .where(eq(jobConversations.jobId, jobId))
        .limit(1);

      if (!conversation) {
        const [createdConv] = await db
          .insert(jobConversations)
          .values({
            jobId,
            status: "ACTIVE",
          })
          .onConflictDoNothing({ target: jobConversations.jobId })
          .returning();
        conversation = createdConv ?? (
          await db
            .select()
            .from(jobConversations)
            .where(eq(jobConversations.jobId, jobId))
            .limit(1)
        )[0];
      }

      if (!conversation) {
        return reply.code(500).send({
          code: "CONVERSATION_INIT_FAILED",
          message: "Could not initialize conversation",
        });
      }

      // Ensure masked_communication_sessions record exists
      let [maskedSession] = await db
        .select()
        .from(maskedCommunicationSessions)
        .where(eq(maskedCommunicationSessions.jobId, jobId))
        .limit(1);

      if (!maskedSession) {
        const idents = generateMaskedSessionIdentifiers(jobId);
        const expiresAt = new Date(Date.now() + 86_400_000 * 3); // 3 days expiry
        const [createdSession] = await db
          .insert(maskedCommunicationSessions)
          .values({
            jobId,
            virtualProxyNumber: idents.virtualProxyNumber,
            sessionExtension: idents.sessionExtension,
            sessionPin: idents.sessionPin,
            customerUserId: jobContext.customerId,
            technicianUserId: jobContext.technicianUserId,
            isActive: true,
            expiresAt,
          })
          .onConflictDoNothing({ target: maskedCommunicationSessions.jobId })
          .returning();
        maskedSession = createdSession ?? (
          await db
            .select()
            .from(maskedCommunicationSessions)
            .where(eq(maskedCommunicationSessions.jobId, jobId))
            .limit(1)
        )[0];
      }

      // Query message history
      const rawMessages = await db
        .select({
          id: jobMessages.id,
          conversationId: jobMessages.conversationId,
          jobId: jobMessages.jobId,
          senderUserId: jobMessages.senderUserId,
          senderRole: jobMessages.senderRole,
          senderDisplayName: users.displayName,
          content: jobMessages.content,
          attachmentKeys: jobMessages.attachmentKeys,
          status: jobMessages.status,
          moderationStatus: jobMessages.moderationStatus,
          moderationReason: jobMessages.moderationReason,
          createdAt: jobMessages.createdAt,
          deliveredAt: jobMessages.deliveredAt,
          readAt: jobMessages.readAt,
          readBy: jobMessages.readBy,
        })
        .from(jobMessages)
        .innerJoin(users, eq(users.id, jobMessages.senderUserId))
        .where(eq(jobMessages.jobId, jobId))
        .orderBy(jobMessages.createdAt);

      const messages: MessageDTO[] = rawMessages.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        jobId: m.jobId,
        senderUserId: m.senderUserId,
        senderRole: m.senderRole as Role,
        senderDisplayName: m.senderDisplayName,
        content: m.content,
        attachmentKeys: (m.attachmentKeys as string[]) ?? [],
        status: m.status as any,
        moderationStatus: m.moderationStatus as any,
        moderationReason: m.moderationReason ?? null,
        createdAt: m.createdAt.toISOString(),
        deliveredAt: m.deliveredAt ? m.deliveredAt.toISOString() : null,
        readAt: m.readAt ? m.readAt.toISOString() : null,
        readBy: m.readBy ?? null,
      }));

      // Count unread messages sent by others
      const unreadCount = messages.filter(
        (m) => m.senderUserId !== currentActor.id && !m.readAt,
      ).length;

      return {
        id: conversation.id,
        jobId: conversation.jobId,
        serviceRequestId: jobContext.serviceRequestId,
        status: conversation.status,
        customer: {
          id: jobContext.customerId,
          displayName: jobContext.customerName,
          maskedPhone: maskPhoneNumber("+14165550198"),
        },
        technician: {
          id: jobContext.technicianId,
          displayName: jobContext.technicianName,
          tradeTitle: "Certified Tradesperson",
          maskedPhone: maskPhoneNumber("+16475550192"),
        },
        maskedSession: {
          id: maskedSession?.id ?? "",
          jobId,
          virtualProxyNumber: maskedSession?.virtualProxyNumber ?? "+16475550199",
          sessionExtension: maskedSession?.sessionExtension ?? "1001",
          sessionPin: maskedSession?.sessionPin ?? "4091",
          customerUserId: jobContext.customerId,
          technicianUserId: jobContext.technicianUserId,
          isActive: maskedSession?.isActive ?? true,
          expiresAt: maskedSession?.expiresAt
            ? maskedSession.expiresAt.toISOString()
            : new Date().toISOString(),
          emergencyDirectPhone: EMERGENCY_SAFETY_DESK_PHONE,
          callRecordingConsentNotice: MASKED_COMMUNICATIONS_CONSENT,
        },
        unreadCount,
        messages,
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
      };
    },
  );

  // ---------------------------------------------------------------------------
  // 2. Send Message (Job-Scoped, Moderated, Delivered)
  // ---------------------------------------------------------------------------
  app.post(
    "/v1/jobs/:id/messages",
    { preHandler: authenticate },
    async (request, reply) => {
      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(sendMessageSchema, request.body);
      const currentActor = actor(request);

      const [jobContext] = await db
        .select({
          jobId: jobs.id,
          jobStatus: jobs.status,
          contractorId: jobs.contractorId,
          serviceRequestId: jobs.serviceRequestId,
          customerId: serviceRequests.customerId,
          technicianUserId: technicians.userId,
          contractorOwnerUserId: contractors.ownerUserId,
        })
        .from(jobs)
        .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
        .innerJoin(technicians, eq(technicians.id, jobs.technicianId))
        .innerJoin(contractors, eq(contractors.id, jobs.contractorId))
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (!jobContext) {
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "Job not found" });
      }

      // Authorization guard
      const isCustomer = jobContext.customerId === currentActor.id;
      const isTech = jobContext.technicianUserId === currentActor.id;
      const isContractor =
        jobContext.contractorOwnerUserId === currentActor.id ||
        jobContext.contractorId === currentActor.contractorId;
      const isStaff = isOps(currentActor);

      if (!isCustomer && !isTech && !isContractor && !isStaff) {
        return reply.code(403).send({
          code: "FORBIDDEN",
          message: "You are not authorized to send messages in this job conversation",
        });
      }

      // Suspended / Closed access policy guard
      if (["CANCELLED", "CLOSED"].includes(jobContext.jobStatus)) {
        return reply.code(409).send({
          code: "JOB_MESSAGING_CLOSED",
          message: "Messaging is closed because the job has been cancelled or completed beyond the active communication window",
        });
      }

      // Safety quarantine guard
      const [quarantine] = await db
        .select({ id: contractorSafetyQuarantines.id })
        .from(contractorSafetyQuarantines)
        .where(
          and(
            eq(contractorSafetyQuarantines.contractorId, jobContext.contractorId),
            eq(contractorSafetyQuarantines.active, true),
          ),
        )
        .limit(1);

      if (quarantine && (isTech || isContractor) && !isStaff) {
        return reply.code(403).send({
          code: "ACCESS_RESTRICTED",
          message: "Account is under active safety quarantine. Communications are suspended.",
        });
      }

      // Idempotency check if idempotencyKey provided
      if (body.idempotencyKey) {
        const [existing] = await db
          .select({
            id: jobMessages.id,
            conversationId: jobMessages.conversationId,
            jobId: jobMessages.jobId,
            senderUserId: jobMessages.senderUserId,
            senderRole: jobMessages.senderRole,
            content: jobMessages.content,
            attachmentKeys: jobMessages.attachmentKeys,
            status: jobMessages.status,
            moderationStatus: jobMessages.moderationStatus,
            moderationReason: jobMessages.moderationReason,
            createdAt: jobMessages.createdAt,
            deliveredAt: jobMessages.deliveredAt,
            readAt: jobMessages.readAt,
            readBy: jobMessages.readBy,
          })
          .from(jobMessages)
          .where(
            and(
              eq(jobMessages.jobId, jobId),
              eq(jobMessages.idempotencyKey, body.idempotencyKey),
            ),
          )
          .limit(1);

        if (existing) {
          const [sender] = await db
            .select({ displayName: users.displayName })
            .from(users)
            .where(eq(users.id, existing.senderUserId))
            .limit(1);

          return reply.code(200).send({
            id: existing.id,
            conversationId: existing.conversationId,
            jobId: existing.jobId,
            senderUserId: existing.senderUserId,
            senderRole: existing.senderRole,
            senderDisplayName: sender?.displayName ?? "User",
            content: existing.content,
            attachmentKeys: (existing.attachmentKeys as string[]) ?? [],
            status: existing.status,
            moderationStatus: existing.moderationStatus,
            moderationReason: existing.moderationReason,
            createdAt: existing.createdAt.toISOString(),
            deliveredAt: existing.deliveredAt
              ? existing.deliveredAt.toISOString()
              : null,
            readAt: existing.readAt ? existing.readAt.toISOString() : null,
            readBy: existing.readBy,
          });
        }
      }

      // Ensure conversation exists
      let [conversation] = await db
        .select({ id: jobConversations.id })
        .from(jobConversations)
        .where(eq(jobConversations.jobId, jobId))
        .limit(1);

      if (!conversation) {
        const [created] = await db
          .insert(jobConversations)
          .values({ jobId, status: "ACTIVE" })
          .onConflictDoNothing({ target: jobConversations.jobId })
          .returning({ id: jobConversations.id });
        conversation = created ?? (
          await db
            .select({ id: jobConversations.id })
            .from(jobConversations)
            .where(eq(jobConversations.jobId, jobId))
            .limit(1)
        )[0];
      }

      const conversationId = conversation?.id;
      if (!conversationId) {
        return reply.code(500).send({
          code: "CONVERSATION_UNAVAILABLE",
          message: "Unable to load job conversation",
        });
      }

      // Content Moderation Screening
      const moderation = screenMessageContent(body.content);

      // Insert message record
      const [inserted] = await db
        .insert(jobMessages)
        .values({
          conversationId,
          jobId,
          senderUserId: currentActor.id,
          senderRole: (currentActor.roles[0] ?? "CUSTOMER") as Role,
          content: body.content,
          attachmentKeys: body.attachmentKeys,
          status: "DELIVERED",
          moderationStatus: moderation.status,
          moderationReason:
            moderation.reasons.length > 0 ? moderation.reasons.join(", ") : null,
          idempotencyKey: body.idempotencyKey ?? null,
          deliveredAt: new Date(),
        })
        .returning();

      if (!inserted) {
        throw new Error("MESSAGE_INSERT_FAILED");
      }

      // Touch conversation updated_at
      await db
        .update(jobConversations)
        .set({ updatedAt: new Date() })
        .where(eq(jobConversations.id, conversationId));

      // Audit event
      await audit(
        currentActor.id,
        "MESSAGE_SENT",
        "JOB_MESSAGE",
        inserted.id,
        null,
        {
          jobId,
          conversationId,
          moderationStatus: moderation.status,
          moderationReason: moderation.reasons,
          attachmentCount: (body.attachmentKeys ?? []).length,
        },
      );

      // Real-time recipient push notification
      const recipientUserId = isCustomer
        ? jobContext.technicianUserId
        : jobContext.customerId;

      await notify(
        recipientUserId,
        "JOB_MESSAGE_RECEIVED",
        `New message regarding Job #${jobId.slice(0, 8)}`,
        body.content.slice(0, 120),
        {
          jobId,
          messageId: inserted.id,
          senderUserId: currentActor.id,
        },
      );

      const [senderUser] = await db
        .select({ displayName: users.displayName })
        .from(users)
        .where(eq(users.id, currentActor.id))
        .limit(1);

      return reply.code(201).send({
        id: inserted.id,
        conversationId: inserted.conversationId,
        jobId: inserted.jobId,
        senderUserId: inserted.senderUserId,
        senderRole: inserted.senderRole,
        senderDisplayName: senderUser?.displayName ?? "User",
        content: inserted.content,
        attachmentKeys: (inserted.attachmentKeys as string[]) ?? [],
        status: inserted.status,
        moderationStatus: inserted.moderationStatus,
        moderationReason: inserted.moderationReason,
        createdAt: inserted.createdAt.toISOString(),
        deliveredAt: inserted.deliveredAt ? inserted.deliveredAt.toISOString() : null,
        readAt: inserted.readAt ? inserted.readAt.toISOString() : null,
        readBy: inserted.readBy,
      });
    },
  );

  // ---------------------------------------------------------------------------
  // 3. Mark Messages as Read
  // ---------------------------------------------------------------------------
  app.post(
    "/v1/jobs/:id/messages/read",
    { preHandler: authenticate },
    async (request, reply) => {
      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const body = parse(markMessagesReadSchema, request.body ?? {});
      const currentActor = actor(request);

      const [jobContext] = await db
        .select({
          customerId: serviceRequests.customerId,
          technicianUserId: technicians.userId,
          contractorOwnerUserId: contractors.ownerUserId,
          contractorId: jobs.contractorId,
        })
        .from(jobs)
        .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
        .innerJoin(technicians, eq(technicians.id, jobs.technicianId))
        .innerJoin(contractors, eq(contractors.id, jobs.contractorId))
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (!jobContext) {
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "Job not found" });
      }

      // Authorization guard
      const isParticipant =
        jobContext.customerId === currentActor.id ||
        jobContext.technicianUserId === currentActor.id ||
        jobContext.contractorOwnerUserId === currentActor.id ||
        jobContext.contractorId === currentActor.contractorId ||
        isOps(currentActor);

      if (!isParticipant) {
        return reply.code(403).send({
          code: "FORBIDDEN",
          message: "You are not authorized to access this job conversation",
        });
      }

      const readTime = new Date();

      const updated = await db
        .update(jobMessages)
        .set({
          status: "READ",
          readAt: readTime,
          readBy: currentActor.id,
        })
        .where(
          and(
            eq(jobMessages.jobId, jobId),
            sql`${jobMessages.senderUserId} <> ${currentActor.id}`,
            sql`${jobMessages.readAt} IS NULL`,
          ),
        )
        .returning({ id: jobMessages.id });

      await audit(
        currentActor.id,
        "MESSAGES_READ",
        "JOB_CONVERSATION",
        jobId,
        null,
        { readCount: updated.length, readAt: readTime.toISOString() },
      );

      return reply.code(200).send({
        success: true,
        updatedCount: updated.length,
      });
    },
  );

  // ---------------------------------------------------------------------------
  // 4. Get Masked Communication Bridge (Virtual Number & Session PIN)
  // ---------------------------------------------------------------------------
  app.get(
    "/v1/jobs/:id/masked-bridge",
    { preHandler: authenticate },
    async (request, reply) => {
      const jobId = parse(z.object({ id: uuid }), request.params).id;
      const currentActor = actor(request);

      const [jobContext] = await db
        .select({
          customerId: serviceRequests.customerId,
          technicianUserId: technicians.userId,
          contractorOwnerUserId: contractors.ownerUserId,
          contractorId: jobs.contractorId,
        })
        .from(jobs)
        .innerJoin(serviceRequests, eq(serviceRequests.id, jobs.serviceRequestId))
        .innerJoin(technicians, eq(technicians.id, jobs.technicianId))
        .innerJoin(contractors, eq(contractors.id, jobs.contractorId))
        .where(eq(jobs.id, jobId))
        .limit(1);

      if (!jobContext) {
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "Job not found" });
      }

      const isParticipant =
        jobContext.customerId === currentActor.id ||
        jobContext.technicianUserId === currentActor.id ||
        jobContext.contractorOwnerUserId === currentActor.id ||
        jobContext.contractorId === currentActor.contractorId ||
        isOps(currentActor);

      if (!isParticipant) {
        return reply.code(403).send({
          code: "FORBIDDEN",
          message: "You are not authorized to view the masked communication bridge for this job",
        });
      }

      let [maskedSession] = await db
        .select()
        .from(maskedCommunicationSessions)
        .where(eq(maskedCommunicationSessions.jobId, jobId))
        .limit(1);

      if (!maskedSession) {
        const idents = generateMaskedSessionIdentifiers(jobId);
        const expiresAt = new Date(Date.now() + 86_400_000 * 3);
        const [created] = await db
          .insert(maskedCommunicationSessions)
          .values({
            jobId,
            virtualProxyNumber: idents.virtualProxyNumber,
            sessionExtension: idents.sessionExtension,
            sessionPin: idents.sessionPin,
            customerUserId: jobContext.customerId,
            technicianUserId: jobContext.technicianUserId,
            isActive: true,
            expiresAt,
          })
          .onConflictDoNothing({ target: maskedCommunicationSessions.jobId })
          .returning();

        maskedSession = created ?? (
          await db
            .select()
            .from(maskedCommunicationSessions)
            .where(eq(maskedCommunicationSessions.jobId, jobId))
            .limit(1)
        )[0];
      }

      return reply.code(200).send({
        id: maskedSession?.id,
        jobId,
        virtualProxyNumber: maskedSession?.virtualProxyNumber ?? "+16475550199",
        sessionExtension: maskedSession?.sessionExtension ?? "1001",
        sessionPin: maskedSession?.sessionPin ?? "4091",
        customerUserId: jobContext.customerId,
        technicianUserId: jobContext.technicianUserId,
        isActive: maskedSession?.isActive ?? true,
        expiresAt: maskedSession?.expiresAt.toISOString(),
        emergencyDirectPhone: EMERGENCY_SAFETY_DESK_PHONE,
        callRecordingConsentNotice: MASKED_COMMUNICATIONS_CONSENT,
      });
    },
  );
};
