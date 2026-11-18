/**
 * @module @jini-ai/mcp/bin/stdio-error-reporter
 * The one incident reporter of the `jini-mcp` stdio process: one error ID format (`ERR-XXXX-XXXX-XXXX-XXXX`,
 * the same core function the daemon-side boundaries use) and one record path (the process's stderr logger).
 */
import { randomBytes } from 'node:crypto';
import { createErrorCatalog } from '@jini-ai/core/errors/catalog';
import { mintToolErrorId } from '@jini-ai/core/errors/error-id';
import { createErrorReporter, type ErrorReporter } from '@jini-ai/core/errors/reporter';
import { createConsoleLogger, type Logger } from '@jini-ai/core/primitives';

export interface StdioErrorReporterOptions {
  /** @default the console logger, which writes to stderr (stdout carries the MCP protocol) */
  readonly logger?: Logger;
}

/** The reporter's `record` port, the shape `McpToolServerOptions.reportFailure` takes. */
export type StdioReportFailure = ErrorReporter['record'];

/**
 * Builds the reporter for one stdio process.
 * @param required.version - The package version, recorded as both the app and the engine version of every incident.
 * @returns The reporter's `record`: it writes one stderr record and returns the error ID the model is told.
 * @complexity O(1) per record.
 */
export function createStdioReportFailure(required: { version: string }, optional: StdioErrorReporterOptions = {}): StdioReportFailure {
  const reporter = createErrorReporter({
    ids: { newId: () => mintToolErrorId({ randomHex: ({ bytes }) => randomBytes(bytes).toString('hex') }) },
    clock: { nowMs: () => Date.now() },
    logger: optional.logger ?? createConsoleLogger({ prefix: '[jini-mcp]' }),
    // This stdio process has no incident tracker. Not a swallowed error: the logger above still writes every record to stderr.
    tracker: { reportError() {} },
    catalog: createErrorCatalog({ sentences: [], scopes: [] }),
    versions: { app: required.version, jini: required.version },
  });
  return reporter.record;
}
