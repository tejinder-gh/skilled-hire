import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const ALLOWED_APPLICATION_ERROR_CODES = new Set([
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "FORBIDDEN",
  "UNAUTHORIZED",
  "CONFLICT",
  "BAD_REQUEST",
  "ALREADY_ASSIGNED",
  "INELIGIBLE_TECHNICIAN",
  "CONTRACTOR_TECHNICIAN_MISMATCH",
  "TECHNICIAN_NOT_FOUND",
  "REGULATORY_ELIGIBILITY_FAILED",
  "PRE_DISPATCH_INELIGIBLE",
  "PRE_WORK_CHECK_FAILED",
  "CRITICAL_RISK_MANUAL_APPROVAL_REQUIRED",
  "UNFULFILLED_MANDATORY_SAFETY_CONTROLS",
  "REGULATORY_SIGN_OFF_REQUIRED",
  "RISK_POLICY_NOT_FOUND",
  "RISK_ASSESSMENT_NOT_FOUND",
  "INVALID_CONTROL_CODE",
  "POLICY_CREATION_FAILED",
  "CONTRACTOR_QUARANTINED",
  "TECHNICIAN_SUSPENDED",
  "PERMIT_NOT_APPROVED",
  "ESA_INSPECTION_REQUIRED",
  "DEFECT_NOT_RESOLVED",
]);

export function errorHandler(
  error: FastifyError | Error | unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const message =
    error instanceof Error ? error.message : "Unknown request error";
  const errorObj = error as { code?: string; statusCode?: number; details?: unknown } | null;
  const isAppCode =
    typeof errorObj?.code === "string" &&
    ALLOWED_APPLICATION_ERROR_CODES.has(errorObj.code);
  const code =
    error instanceof z.ZodError
      ? "VALIDATION_ERROR"
      : isAppCode
        ? (errorObj!.code as string)
        : message === "FORBIDDEN"
          ? "FORBIDDEN"
          : message === "NOT_FOUND"
            ? "NOT_FOUND"
            : "REQUEST_FAILED";
  const status =
    errorObj?.statusCode ??
    (code === "VALIDATION_ERROR"
      ? 400
      : code === "FORBIDDEN"
        ? 403
        : code === "NOT_FOUND"
          ? 404
          : 409);

  request.log.warn({ error, requestId: request.id }, "request failed");
  return reply
    .code(status)
    .send({
      code,
      message:
        code === "REQUEST_FAILED"
          ? "The operation could not be completed"
          : message,
      ...(errorObj?.details ? { details: errorObj.details } : {}),
      requestId: request.id,
    });
}
