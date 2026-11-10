import type { ErrorCode } from "@agentos/protocol";

/** An error a client can understand: becomes an `ApiError` body with the matching HTTP status. */
export class Failure extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "Failure";
  }
}

export const httpStatus = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid: 400,
  conflict: 409,
  rate_limited: 429,
  unavailable: 503,
  internal: 500,
} as const satisfies Record<ErrorCode, number>;
