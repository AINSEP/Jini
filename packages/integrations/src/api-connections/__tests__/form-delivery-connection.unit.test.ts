/**
 * @file The OAuth form-delivery port through its injected host, plugin lookup and error factory:
 * which refs it owns, how the frozen account and per-request tokens work, and which token-read
 * failures become a bare delivery code.
 */
import { describe, expect, it } from 'vitest';
import { ConnectionBudgetExceededError } from '../budgets.js';
import { ApiConnectionError, type ApiConnectionErrorCode } from '../errors.js';
import {
  createOAuthFormDeliveryConnectionPort,
  type OAuthFormDeliveryErrorFactory,
  type OAuthFormDeliveryHost,
} from '../form-delivery-connection.js';

type Init = Parameters<OAuthFormDeliveryErrorFactory>[0];
class FakeDeliveryError extends Error {
  constructor(readonly init: Init) { super(init.code); }
}
const deliveryError: OAuthFormDeliveryErrorFactory = (init) => new FakeDeliveryError(init);

const WORKSPACE = 'ws-1';
const REF = 'conn-ref-1';
const ADAPTER = 'acme-rows';
const PLUGIN = 'acme';

type TokenRead = (required: { connectionRef: string }, optional: { expectedAccountId?: string }) => Promise<string>;

function setup(options: { origins?: readonly string[]; declared?: boolean; pluginId?: string | null; hostless?: boolean; read?: TokenRead } = {}) {
  const log = { hostFor: [] as string[], lookups: [] as Array<{ workspaceId: string; adapterId: string }>, declaredFor: [] as unknown[], accessTokensFor: [] as unknown[], reads: [] as unknown[] };
  const host = {
    declaredFor: async (input: { pluginId: string; connectionRef: string }) => {
      log.declaredFor.push(input);
      return options.declared === false ? undefined : { apiOrigins: options.origins ?? ['https://api.acme.test'] };
    },
    accessTokensFor: (scope: { pluginId: string }) => {
      log.accessTokensFor.push(scope);
      return { getAccessToken: (required: { connectionRef: string }, optional: { expectedAccountId?: string }) => {
        log.reads.push({ required, optional });
        return (options.read ?? (async () => `token-${log.reads.length}`))(required, optional);
      } };
    },
  } as unknown as OAuthFormDeliveryHost;
  const port = createOAuthFormDeliveryConnectionPort({
    hostFor: ({ workspaceId }) => { log.hostFor.push(workspaceId); return options.hostless ? null : host; },
    adapterPluginId: async (input) => { log.lookups.push(input); return options.pluginId === undefined ? PLUGIN : options.pluginId; },
    deliveryError,
  });
  const attempt = (config: Record<string, unknown> | null = { accountId: 'acct-1' }) =>
    port({ workspaceId: WORKSPACE, connectionRef: REF, adapterId: ADAPTER }, config === null ? {} : { binding: { bindingId: 'b1', adapterId: ADAPTER, connectionRef: REF, enabled: true, config } } as never);
  return { port, attempt, log };
}

const refusal = (init: Omit<Init, 'outcome'>) => expect.objectContaining({ init: { ...init, outcome: 'not-applied' } });

describe('ownership: null for any ref this port does not own', () => {
  it('answers null without any adapter lookup when the workspace has no API-connection host', async () => {
    const { attempt, log } = setup({ hostless: true });
    expect(await attempt()).toBeNull();
    expect(log.hostFor).toEqual([WORKSPACE]);
    expect(log.lookups).toEqual([]);
  });

  it('answers null, with no declaration read, when no plugin contributes the adapter', async () => {
    const { attempt, log } = setup({ pluginId: null });
    expect(await attempt()).toBeNull();
    expect(log.lookups).toEqual([{ workspaceId: WORKSPACE, adapterId: ADAPTER }]);
    expect(log.declaredFor).toEqual([]);
  });

  it('answers null for a ref the adapter\'s own plugin does not declare, and never reads a token for it', async () => {
    const { attempt, log } = setup({ declared: false });
    expect(await attempt()).toBeNull();
    expect(log.declaredFor).toEqual([{ pluginId: PLUGIN, connectionRef: REF }]);
    expect(log.accessTokensFor).toEqual([]);
  });
});

describe('credential shape', () => {
  it('maps the declared API origins to base URL (the first) and additional hosts (the rest)', async () => {
    const credential = await setup({ origins: ['https://api.acme.test', 'https://files.acme.test', 'https://upload.acme.test:8443'] }).attempt();
    expect(credential).toMatchObject({ token: 'token-1', baseUrl: 'https://api.acme.test', additionalHosts: ['https://files.acme.test', 'https://upload.acme.test:8443'] });
  });

  it('allows nothing when the connection declares no origins: empty base URL and no extra host', async () => {
    const credential = await setup({ origins: [] }).attempt();
    expect({ baseUrl: credential?.baseUrl, additionalHosts: credential?.additionalHosts }).toEqual({ baseUrl: '', additionalHosts: [] });
  });

  it('reads the token as the owning plugin, for the ref, on the binding\'s frozen account', async () => {
    const { attempt, log } = setup();
    await attempt({ accountId: 'acct-frozen' });
    expect(log.accessTokensFor).toEqual([{ pluginId: PLUGIN }]);
    expect(log.reads).toEqual([{ required: { connectionRef: REF }, optional: { expectedAccountId: 'acct-frozen' } }]);
  });

  it('hands out the attempt\'s first token once, then a fresh frozen-account read per request', async () => {
    const { attempt, log } = setup();
    const credential = (await attempt())!;
    expect(log.reads).toHaveLength(1);
    expect(await credential.getAccessToken()).toBe('token-1');
    expect(log.reads, 'the first per-request call reuses the attempt\'s read').toHaveLength(1);
    expect(await credential.getAccessToken()).toBe('token-2');
    expect(await credential.getAccessToken()).toBe('token-3');
    expect(log.reads.map((read) => (read as { optional: unknown }).optional)).toEqual(Array(3).fill({ expectedAccountId: 'acct-1' }));
  });
});

describe('the frozen account fails closed', () => {
  it.each([
    ['no accountId', {}],
    ['an empty accountId', { accountId: '' }],
    ['a non-text accountId', { accountId: 7 }],
    ['a null accountId', { accountId: null }],
  ])('refuses a binding with %s as configuration-invalid before any token is read', async (_name, config) => {
    const { attempt, log } = setup();
    await expect(attempt(config)).rejects.toEqual(refusal({ code: 'configuration-invalid', retryable: false }));
    expect(log.accessTokensFor, 'nothing reached the provider').toEqual([]);
  });

  it('refuses an attempt with no frozen binding at all, so a job can never follow whatever account the ref holds today', async () => {
    const { attempt, log } = setup();
    await expect(attempt(null)).rejects.toEqual(refusal({ code: 'configuration-invalid', retryable: false }));
    expect(log.reads).toEqual([]);
  });
});

describe('first token read failures become a bare delivery code', () => {
  it.each(['connection-not-found', 'not-connected', 'reconnect-required', 'revocation-pending', 'account-changed'] as ApiConnectionErrorCode[])(
    'maps API-connection code %s to non-retryable authorization-required', async (code) => {
      const { attempt } = setup({ read: async () => { throw new ApiConnectionError({ code, message: 'secret detail' }); } });
      await expect(attempt()).rejects.toEqual(refusal({ code: 'authorization-required', retryable: false }));
    });

  it('maps a refused budget charge to rate-limited, keeping the host\'s wait', async () => {
    const { attempt } = setup({ read: async () => { throw new ConnectionBudgetExceededError({ retryAfterMs: 4321 }); } });
    await expect(attempt()).rejects.toEqual(refusal({ code: 'rate-limited', retryable: true, retryAfterMs: 4321 }));
  });

  it.each(['storage-conflict', 'account-mismatch', 'request-invalid'] as ApiConnectionErrorCode[])(
    'returns an API-connection error with code %s unchanged: no person can fix it, the ledger records it as retryable', async (code) => {
      const failure = new ApiConnectionError({ code, message: 'transient' });
      await expect(setup({ read: async () => { throw failure; } }).attempt()).rejects.toBe(failure);
    });

  it('returns any non-API failure unchanged', async () => {
    const failure = new Error('socket hang up');
    await expect(setup({ read: async () => { throw failure; } }).attempt()).rejects.toBe(failure);
  });

  it('does not map later per-request failures: the plugin that made the request maps them itself', async () => {
    let calls = 0;
    const later = new ApiConnectionError({ code: 'reconnect-required', message: 'expired mid-delivery' });
    const { attempt } = setup({ read: async () => { if (++calls === 1) return 'first'; throw later; } });
    const credential = (await attempt())!;
    expect(await credential.getAccessToken()).toBe('first');
    await expect(credential.getAccessToken()).rejects.toBe(later);
  });
});
