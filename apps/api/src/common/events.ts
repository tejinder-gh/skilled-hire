import { db, auditEvents, domainEvents, notifications } from "@marketplace/database";

export async function audit(
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(auditEvents).values({
    actorId,
    actorType: actorId ? "USER" : "SYSTEM",
    action,
    entityType,
    entityId,
    beforeState: before as any,
    afterState: after as any,
    metadata,
  });
}

export async function emit(
  aggregateType: string,
  aggregateId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.insert(domainEvents).values({
    aggregateType,
    aggregateId,
    eventType,
    payload,
  });
}

export async function notify(
  recipientUserId: string,
  eventType: string,
  title: string,
  body: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await db.insert(notifications).values({
    recipientUserId,
    eventType,
    title,
    body,
    payload,
  });
}
