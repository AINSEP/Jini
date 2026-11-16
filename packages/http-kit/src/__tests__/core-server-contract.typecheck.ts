/** Compile-time pins: core restates the wire error shape and the host context structurally, so
 * these must stay mutually assignable with their protocol-side twins. */
import type { RouteHostContext, ServerApiError, ReportRouteInternalError } from '@jini-ai/core/contracts/server';
import type { ApiError } from '@jini-ai/protocol';
import { reportRouteInternalError } from '../internal-error.js';

export const apiErrorToCore: ServerApiError = {} as ApiError;
export const coreToApiError: ApiError = {} as ServerApiError;
export const reporterFits = reportRouteInternalError satisfies ReportRouteInternalError;
export type HostContextIsReadable = RouteHostContext['reportInternalError'];
