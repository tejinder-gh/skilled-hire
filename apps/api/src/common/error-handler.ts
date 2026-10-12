import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

export function errorHandler(
  error: FastifyError | Error | unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const message =
    error instanceof Error ? error.message : "Unknown request error";
  const errorObj = error as { code?: string; statusCode?: number; details?: unknown } | null;
  const code =
    error instanceof z.ZodError
      ? "VALIDATION_ERROR"
      : typeof errorObj?.code === "string" && errorObj.code !== ""
        ? errorObj.code
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
