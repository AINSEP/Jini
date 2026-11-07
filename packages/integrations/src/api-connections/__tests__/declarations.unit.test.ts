import { describe, expect, it } from 'vitest';
import {
  asApiConnectionHooksModule, checkApiConnectionClientNamespace, ConnectionBudgetExceededError, createConnectionBudgets,
  HOST_BUDGET_MAXIMUM, parseApiConnectionsFile, type CreateConnectionBudgetLimiter,
} from '../index.js';

const clientNamespace = 'ACME_';
const web = { clientIdEnv: 'ACME_SHOP_OAUTH_WEB_CLIENT_ID', clientSecretEnv: 'ACME_SHOP_OAUTH_WEB_CLIENT_SECRET' };
const file = (connections: unknown[]) => JSON.stringify({ schemaVersion: 1, connections });
const entry = (over: Record<string, unknown> = {}) => ({ id: 'account', module: 'hooks.mjs', clients: { web }, extra: 1, ...over });
const reasonOf = (raw: string) => { const parsed = parseApiConnectionsFile({ raw, clientNamespace }); return parsed.ok ? '' : parsed.reason; };

describe('parseApiConnectionsFile', () => {
  it('keeps host-read fields off the descriptor and adds the default instance budget', () => {
    const parsed = parseApiConnectionsFile({ raw: file([entry()]), clientNamespace });
    expect(parsed).toEqual({ ok: true, descriptors: [{
      id: 'account', module: 'hooks.mjs', clients: { web }, budgets: [{ scope: 'instance', ...HOST_BUDGET_MAXIMUM }],
      scopeSets: [], apiOrigins: [], byoClient: false, descriptor: { extra: 1 },
    }] });
  });

  it('names the host namespace when a setting lies outside it', () => {
    expect(reasonOf(file([entry({ clients: { web: { clientIdEnv: 'OTHER_SHOP_CLIENT_ID' } } })])))
      .toBe('connections[0].clients.web.clientIdEnv must name a ACME_…_CLIENT_ID setting');
    expect(reasonOf(file([entry({ clients: { desktop: { ...web, clientSecretEnv: 'DATABASE_PASSWORD' } } })])))
      .toBe('connections[0].clients.desktop.clientSecretEnv must name a ACME_…_CLIENT_SECRET setting');
  });

  it('refuses a malformed host namespace instead of accepting every name', () => {
    for (const bad of ['', 'acme_', 'ACME', '.*_']) expect(() => parseApiConnectionsFile({ raw: file([]), clientNamespace: bad })).toThrow(TypeError);
  });

  it('refuses bad shape, duplicates and bad budgets', () => {
    expect(reasonOf('{')).toBe('not valid JSON');
    expect(reasonOf(file([entry(), entry()]))).toBe("connections[1].id 'account' is declared twice");
    expect(reasonOf(file([entry({ budgets: [{ scope: 'galaxy', perMinute: 1 }] })]))).toBe('connections[0].budgets[0].scope must be "instance" or "connection"');
  });
});

describe('client namespace and hooks module', () => {
  it('admits only the plugin-id namespace, with distinct encodings for dots and hyphens', () => {
    expect(() => checkApiConnectionClientNamespace({ pluginId: 'shop', clients: { web }, clientNamespace })).not.toThrow();
    expect(() => checkApiConnectionClientNamespace({ pluginId: 'sh.op', clients: { web }, clientNamespace }))
      .toThrow("Client settings must belong to this plugin's ACME_SH__OP_ namespace.");
  });

  it('requires a createHooks function', () => {
    const module = { createHooks: () => ({}) };
    expect(asApiConnectionHooksModule({ exported: module })).toBe(module);
    expect(asApiConnectionHooksModule({ exported: {} })).toBe('its module has no createHooks() function');
  });
});

describe('createConnectionBudgets', () => {
  it('checks the account budget first and refuses through the host limiter port', async () => {
    const keys: string[] = [];
    const createLimiter: CreateConnectionBudgetLimiter = ({ profile }) => ({
      check: async ({ key }) => { keys.push(`${profile.max}:${key.split('\u0000')[3]}`); return keys.length < 2 ? { allowed: true } : { allowed: false, retryAfterSeconds: 3 }; },
    });
    const budgets = createConnectionBudgets({ clock: { now: () => new Date(0) } as never, createLimiter });
    const target = { workspaceId: 'w', pluginId: 'p', connectionId: 'c', connectionRef: 'r', budgets: [{ scope: 'instance' as const, perMinute: 9, burst: 0 }, { scope: 'connection' as const, perMinute: 2, burst: 0 }] };
    await expect(budgets.charge(target)).rejects.toMatchObject({ name: 'ConnectionBudgetExceededError', retryAfterMs: 3000 });
    expect(keys).toEqual(['2:r', '9:']);
    expect(new ConnectionBudgetExceededError({ retryAfterMs: 1 }).outcome).toBe('not-applied');
  });
});
