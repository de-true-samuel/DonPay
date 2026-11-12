import type { ErrorCode } from './shared/contract';

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  CSRF_HEADER_MISSING: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  OPEN_REQUEST_EXISTS: 409,
  INVALID_STATE: 409,
  NOTHING_OWED: 409,
  RATE_LIMITED: 429,
  KORA_UNAVAILABLE: 502,
  REQUEST_NOT_WAITING: 409,
  REQUEST_EXPIRED: 409,
  JOB_NOT_READY: 409,
  IDEMPOTENCY_KEY_REUSED: 422,
  IDEMPOTENCY_IN_PROGRESS: 409,
  INTERNAL: 500,
};

/** An error that maps directly to a contract error response. */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} not found`);
export const invalidState = (message: string) => new AppError('INVALID_STATE', message);
export const validation = (message: string, field?: string) =>
  new AppError('VALIDATION_ERROR', message, {
    fieldErrors: field ? { [field]: [message] } : {},
    formErrors: field ? [] : [message],
  });
