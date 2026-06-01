import type { Context } from "hono";

/** Uniform API error per SPEC §6.3. */
export class ApiError extends Error {
  status: number;
  code: string;
  field?: string;

  constructor(status: number, code: string, message: string, field?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

export const badRequest = (code: string, message: string, field?: string) =>
  new ApiError(400, code, message, field);
export const unauthorized = (message = "missing or invalid API key") =>
  new ApiError(401, "unauthorized", message);
export const forbidden = (message = "insufficient permissions") =>
  new ApiError(403, "forbidden", message);
export const notFound = (message = "not found") =>
  new ApiError(404, "not_found", message);
export const conflict = (code: string, message: string) =>
  new ApiError(409, code, message);
export const tooManyRequests = (message = "rate limit exceeded") =>
  new ApiError(429, "rate_limited", message);

/** Serialize an error into the SPEC's JSON envelope. */
export function errorBody(err: unknown): {
  status: number;
  body: { error: string; message: string; field?: string };
} {
  if (err instanceof ApiError) {
    return {
      status: err.status,
      body: { error: err.code, message: err.message, ...(err.field ? { field: err.field } : {}) },
    };
  }
  const message = err instanceof Error ? err.message : "internal error";
  return { status: 500, body: { error: "internal_error", message } };
}

export function sendError(c: Context, err: unknown) {
  const { status, body } = errorBody(err);
  return c.json(body, status as never);
}
