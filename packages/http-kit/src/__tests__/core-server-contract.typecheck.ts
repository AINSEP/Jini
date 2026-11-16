/** Compile-time pins: core restates the wire error shape and the host context structurally, so
 * these must stay mutually assignable with their protocol-side twins. */
import type { ServerApiError, ServerValidationIssue, ReportRouteInternalError } from '@jini-ai/core/contracts/server';
import type { ApiError, ApiValidationIssue } from '@jini-ai/protocol';
import { reportRouteInternalError } from '../internal-error.js';

export const apiErrorToCore: ServerApiError = {} as ApiError;
export const coreToApiError: ApiError = {} as ServerApiError;
export const reporterFits = reportRouteInternalError satisfies ReportRouteInternalError;
export const issueToCore: ServerValidationIssue = {} as Pick<ApiValidationIssue, 'path' | 'message'>;
export const coreToIssue: Pick<ApiValidationIssue, 'path' | 'message'> = {} as ServerValidationIssue;
