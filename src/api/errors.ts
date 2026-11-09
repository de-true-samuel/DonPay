import { ApiRequestError } from './client';

export interface Described { message: string; fieldErrors?: Record<string, string[]> }

/** Plain-language messages for every contract error code. Errors say what happened and what to do. */
export function describeError(err: unknown): Described {
  if (!(err instanceof ApiRequestError)) return { message: 'Something went wrong. Try again.' };
  switch (err.code) {
    case 'NETWORK': return { message: 'No connection. Check your data and try again.' };
    case 'VALIDATION_ERROR': {
      const d = err.details as { fieldErrors?: Record<string, string[]> } | undefined;
      return { message: 'Check the highlighted fields.', fieldErrors: d?.fieldErrors };
    }
    case 'UNAUTHENTICATED': return { message: 'Your session ended. Sign in again.' };
    case 'CSRF_HEADER_MISSING': return { message: 'The app is misconfigured (missing security header). Tell support.' };
    case 'FORBIDDEN': return { message: 'This isn’t available here.' };
    case 'NOT_FOUND': return { message: 'We couldn’t find that. It may have been removed.' };
    case 'CONFLICT': return { message: err.message };
    case 'OPEN_REQUEST_EXISTS': return { message: 'This job already has an open payment request. Finish or cancel it first.' };
    case 'INVALID_STATE': return { message: 'That can’t be done in the request’s current state.' };
    case 'NOTHING_OWED': return { message: 'Nothing is owed on this job.' };
    case 'RATE_LIMITED': return { message: 'Too many tries. Wait a minute and retry.' };
    case 'KORA_UNAVAILABLE': return { message: 'Kora didn’t respond. Nothing was charged. Try again.' };
    case 'CONTRACT_MISMATCH': return { message: 'The server replied in an unexpected shape. Check the contract version.' };
    case 'INTERNAL':
    default:
      return { message: `Something went wrong on our side.${err.requestId ? ` Reference: ${err.requestId}` : ''}` };
  }
}
