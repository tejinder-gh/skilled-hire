import type { Actor, Role } from "@marketplace/contracts";

export const STAFF_ROLES: readonly Role[] = [
  "OPERATIONS_AGENT",
  "DISPATCHER",
  "SUPPORT_AGENT",
  "QUOTE_REVIEWER",
  "ADMIN",
  "SUPER_ADMIN",
];

export const CONTRACTOR_ROLES: readonly Role[] = [
  "CONTRACTOR_OWNER",
  "CONTRACTOR_MANAGER",
  "TECHNICIAN",
];

export class AuthForbiddenError extends Error {
  readonly code = "FORBIDDEN";
  constructor(message: string) {
    super(message);
    this.name = "AuthForbiddenError";
  }
}

export function isStaff(actor: Actor): boolean {
  return actor.roles.some((role) => STAFF_ROLES.includes(role));
}

export function isContractor(actor: Actor): boolean {
  return actor.roles.some((role) => CONTRACTOR_ROLES.includes(role));
}

export function assertRole(actor: Actor, ...allowed: readonly Role[]): void {
  const authorized = actor.roles.some((role) => allowed.includes(role));
  if (!authorized) {
    throw new AuthForbiddenError(`FORBIDDEN: Requires one of [${allowed.join(", ")}]`);
  }
}

/**
 * Enforces cross-tenant isolation for contractor resources.
 * If actor is staff, cross-tenant access is permitted.
 * If actor is contractor, their assigned contractorId MUST match the resource's contractorId.
 */
export function assertTenantAccess(
  actor: Actor,
  resourceContractorId?: string | null,
): void {
  if (isStaff(actor)) {
    return; // Staff operators have cross-tenant administrative access
  }

  if (isContractor(actor)) {
    if (!actor.contractorId || !resourceContractorId || actor.contractorId !== resourceContractorId) {
      throw new AuthForbiddenError(
        `FORBIDDEN: Cross-tenant isolation violation. Contractor ${actor.contractorId ?? "none"} cannot access resource owned by ${resourceContractorId ?? "unknown"}.`,
      );
    }
    return;
  }

  throw new AuthForbiddenError("FORBIDDEN: Contractor access required");
}

/**
 * Enforces cross-customer isolation for customer resources.
 * If actor is staff, cross-customer access is permitted.
 * If actor is a customer, their actor.id MUST match the resource's customerId.
 */
export function assertCustomerAccess(
  actor: Actor,
  resourceCustomerId?: string | null,
): void {
  if (isStaff(actor)) {
    return; // Staff operators have support/ops access
  }

  if (actor.roles.includes("CUSTOMER")) {
    if (!resourceCustomerId || actor.id !== resourceCustomerId) {
      throw new AuthForbiddenError(
        `FORBIDDEN: Cross-customer isolation violation. Customer ${actor.id} cannot access resource owned by ${resourceCustomerId ?? "unknown"}.`,
      );
    }
    return;
  }

  throw new AuthForbiddenError("FORBIDDEN: Customer access required");
}

/**
 * Composite resource authorization guard.
 */
export function assertResourceAccess(
  actor: Actor,
  options: {
    ownerId?: string | null;
    contractorId?: string | null;
    allowStaff?: boolean;
  },
): void {
  const allowStaff = options.allowStaff ?? true;
  if (allowStaff && isStaff(actor)) {
    return;
  }

  // If contractorId is specified and actor is contractor, verify tenant match
  if (options.contractorId && isContractor(actor)) {
    assertTenantAccess(actor, options.contractorId);
    return;
  }

  // If ownerId is specified, verify direct user ownership
  if (options.ownerId) {
    if (actor.id === options.ownerId) {
      return;
    }
    throw new AuthForbiddenError("FORBIDDEN: You do not own this resource");
  }

  throw new AuthForbiddenError("FORBIDDEN: Access denied");
}
