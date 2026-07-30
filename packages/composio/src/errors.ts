/**
 * Stable error codes returned by the Composio provider and service.
 */
import type { JsonObject } from './catalog.js';

export type ConnectorServiceErrorCode =
  | 'CONNECTOR_NOT_FOUND'
  | 'CONNECTOR_AUTH_CONFIG_REQUIRED'
  | 'CONNECTOR_NOT_CONNECTED'
  | 'CONNECTOR_DISABLED'
  | 'CONNECTOR_TOOL_NOT_FOUND'
  | 'CONNECTOR_SAFETY_DENIED'
  | 'CONNECTOR_INPUT_SCHEMA_MISMATCH'
  | 'CONNECTOR_RATE_LIMITED'
  | 'CONNECTOR_OUTPUT_TOO_LARGE'
  | 'CONNECTOR_EXECUTION_FAILED';

/**
 * Typed boundary error with an HTTP-compatible status for future adapters.
 */
export class ConnectorServiceError extends Error {
  constructor(
    readonly code: ConnectorServiceErrorCode,
    message: string,
    readonly status: number,
    readonly details?: JsonObject,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ConnectorServiceError';
  }
}
