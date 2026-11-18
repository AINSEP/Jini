import { expect, it, vi } from 'vitest';
import type { Logger } from '@jini-ai/core/primitives';
import { createStdioReportFailure } from '../stdio-error-reporter.js';
import { serve } from '../serve.js';

function recordingLogger(): { logger: Logger; errors: Array<{ message: string; meta: Record<string, unknown> | undefined }> } {
  const errors: Array<{ message: string; meta: Record<string, unknown> | undefined }> = [];
  const logger: Logger = {
    info: () => {},
    warn: () => {},
    error: ({ message }, { meta } = {}) => { errors.push({ message, meta }); },
  };
  return { logger, errors };
}

it('mints one ERR- ID per failure and writes one record to the logger', () => {
  const { logger, errors } = recordingLogger();
  const record = createStdioReportFailure({ version: '1.2.3' }, { logger });
  const { errorId } = record({ error: new Error('boom'), step: 'mcp daemon call' });
  expect(errorId).toMatch(/^ERR-[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
  expect(errors).toHaveLength(1);
  expect(errors[0]?.message).toBe(`[incident] mcp daemon call failed (error ${errorId})`);
  expect(errors[0]?.meta).toMatchObject({ errorId, step: 'mcp daemon call', appVersion: '1.2.3', jiniVersion: '1.2.3' });
});

it('two failures get two different IDs', () => {
  const { logger } = recordingLogger();
  const record = createStdioReportFailure({ version: '1.2.3' }, { logger });
  expect(record({ error: new Error('a'), step: 's' }).errorId).not.toBe(record({ error: new Error('b'), step: 's' }).errorId);
});

it('serve hands the host the reporter it was given', async () => {
  const create = vi.fn(() => ({ run: async () => {} }));
  const reportFailure = () => ({ errorId: 'ERR-AAAA-BBBB-CCCC-DDDD' });
  await serve({}, { env: { JINI_RUN_ID: 'run-1', JINI_DAEMON_URL: 'http://127.0.0.1:1' }, createMcpToolServer: create, reportFailure });
  const options = (create.mock.calls[0] as unknown as [unknown, { reportFailure?: unknown }])[1];
  expect(options.reportFailure).toBe(reportFailure);
});

it('serve defaults to a reporter that returns real error IDs', async () => {
  const create = vi.fn(() => ({ run: async () => {} }));
  await serve({}, { env: { JINI_RUN_ID: 'run-1', JINI_DAEMON_URL: 'http://127.0.0.1:1' }, createMcpToolServer: create });
  const options = (create.mock.calls[0] as unknown as [unknown, { reportFailure?: (required: { error: unknown; step: string }) => { errorId: string } }])[1];
  expect(typeof options.reportFailure).toBe('function');
});
