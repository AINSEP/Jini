import { expect, it, vi } from 'vitest';
import { withinRateLimit, externalMcpErrorStatus } from '../route-helpers.js';

it('refuses the probe before its protected work and keeps its own budget copy', async () => {
  const order: string[] = [];
  const proceed = vi.fn();
  const allowed = await withinRateLimit({ deps: {
    check: async () => { order.push('limit'); return { allowed: false, retryAfterSeconds: 7 }; },
    retryAfter: value => { expect(value).toBe('7'); order.push('retry'); },
    json: (body, status) => { expect(status).toBe(429); expect(body).toEqual({ error: 'too many probe attempts', code: 'RATE_LIMIT_EXCEEDED', details: { retryAfterSeconds: 7 } }); order.push('json'); },
    message: 'too many probe attempts',
  } });
  if (allowed) proceed();
  expect(proceed).not.toHaveBeenCalled();
  expect(order).toEqual(['limit', 'retry', 'json']);
});

it('maps known external MCP errors and leaves unknown failures private', () => {
  class ApiError extends Error { code = 'access-denied'; }
  class Validation extends Error { field = 'url'; }
  class Reauth extends Error { code = 'REAUTH'; settingsLink = '/settings'; }
  class Secret extends Error {}
  class OAuth extends Error { code = 'OAUTH_PROVIDER_UNREACHABLE'; retryable = true; operatorAction = 'retry'; }
  const deps = { apiConnection: ApiError, validation: Validation, reauth: Reauth, secretStoreUnconfigured: Secret, oauth: OAuth };
  expect(externalMcpErrorStatus({ error: new ApiError('denied'), deps })).toMatchObject({ status: 403, body: { error: 'denied', code: 'access-denied' } });
  expect(externalMcpErrorStatus({ error: new OAuth('unreachable'), deps })).toMatchObject({ status: 502 });
  expect(externalMcpErrorStatus({ error: new Error('private'), deps })).toBeUndefined();
});

it.each([
  { kind: "bad-input", status: 400, code: "bad-input", detail: {} },
  { kind: "validation", status: 400, code: "INVALID_MCP_SERVER", detail: { details: { field: "endpoint" } } },
  { kind: "reauth", status: 409, code: "REAUTH", detail: { details: { retryable: false, settingsLink: "/settings/integrations" } } },
  { kind: "oauth", status: 502, code: "OAUTH_PROVIDER_UNREACHABLE", detail: { details: {
    retryable: true, operatorAction: "Retry later", retryAfterSeconds: 8,
  } } },
])("preserves the external MCP $kind recovery contract", ({ kind, status, code, detail }) => {
  class ApiError extends Error { code = "bad-input"; }
  class Validation extends Error { field = "endpoint"; }
  class Reauth extends Error { code = "REAUTH"; settingsLink = "/settings/integrations"; }
  class Secret extends Error {}
  class OAuth extends Error {
    code = "OAUTH_PROVIDER_UNREACHABLE"; retryable = true; operatorAction = "Retry later"; retryAfterSeconds = 8;
  }
  const errors = { "bad-input": ApiError, validation: Validation, reauth: Reauth, oauth: OAuth };
  const ErrorType = errors[kind as keyof typeof errors];
  const deps = { apiConnection: ApiError, validation: Validation, reauth: Reauth, secretStoreUnconfigured: Secret, oauth: OAuth };
  expect(externalMcpErrorStatus({ error: new ErrorType("Safe operator copy"), deps }))
    .toStrictEqual({ status, body: { error: "Safe operator copy", code, ...detail } });
});
