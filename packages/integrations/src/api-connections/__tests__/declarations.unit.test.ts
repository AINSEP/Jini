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

  it('keeps a desktop-only client with redirect origins and the bounded host lists', () => {
    const desktop = { clientIdEnv: 'ACME_SHOP_DESKTOP_CLIENT_ID', redirectOrigins: ['http://127.0.0.1:8123', 'https://app.example'] };
    const parsed = parseApiConnectionsFile({ raw: file([entry({ clients: { desktop }, scopeSets: ['read.v1', 'Write_2'], apiOrigins: ['https://api.example'], byoClient: true })]), clientNamespace });
    expect(parsed).toEqual({ ok: true, descriptors: [{
      id: 'account', module: 'hooks.mjs', clients: { desktop }, budgets: [{ scope: 'instance', ...HOST_BUDGET_MAXIMUM }],
      scopeSets: ['read.v1', 'Write_2'], apiOrigins: ['https://api.example'], byoClient: true, descriptor: { extra: 1 },
    }] });
  });

  it('names the first invalid field of a declaration', () => {
    const cases: ReadonlyArray<readonly [unknown, string]> = [
      ['not-an-entry', 'connections[0] must be an object'],
      [entry({ id: 'Bad_Id' }), 'connections[0].id must be a lowercase hyphenated id'],
      [entry({ id: 'a'.repeat(65) }), 'connections[0].id must be a lowercase hyphenated id'],
      [entry({ module: '/abs/hooks.mjs' }), 'connections[0].module must be a relative path ending in .mjs'],
      [entry({ module: 'hooks.js' }), 'connections[0].module must be a relative path ending in .mjs'],
      [entry({ clients: [] }), 'connections[0].clients must be an object'],
      [entry({ clients: { web: 'ACME_X_CLIENT_ID' } }), 'connections[0].clients.web must be an object'],
      [entry({ clients: { web, desktop: 7 } }), 'connections[0].clients.desktop must be an object'],
      [entry({ clients: { web: { ...web, redirectOrigins: ['https://app.example/path'] } } }), 'connections[0].clients.web.redirectOrigins must be a list of origins'],
      [entry({ clients: { web: { ...web, redirectOrigins: 'https://app.example' } } }), 'connections[0].clients.web.redirectOrigins must be a list of origins'],
      [entry({ clients: { web: { ...web, redirectOrigins: Array.from({ length: 33 }, (_, i) => `https://h${i}.example`) } } }), 'connections[0].clients.web.redirectOrigins must be a list of origins'],
      [entry({ scopeSets: ['.hidden'] }), 'connections[0].scopeSets must be at most 16 short ids'],
      [entry({ scopeSets: Array.from({ length: 17 }, (_, i) => `s${i}`) }), 'connections[0].scopeSets must be at most 16 short ids'],
      [entry({ apiOrigins: ['http://api.example'] }), 'connections[0].apiOrigins must be at most 8 https:// origins'],
      [entry({ apiOrigins: [42] }), 'connections[0].apiOrigins must be at most 8 https:// origins'],
      [entry({ byoClient: 'yes' }), 'connections[0].byoClient must be true or false'],
    ];
    for (const [value, reason] of cases) expect(reasonOf(file([value]))).toBe(reason);
  });

  it('refuses a file without schemaVersion 1 or with too many connections', () => {
    expect(reasonOf('[]')).toBe('schemaVersion must be 1');
    expect(reasonOf(JSON.stringify({ schemaVersion: 2, connections: [] }))).toBe('schemaVersion must be 1');
    expect(reasonOf(JSON.stringify({ schemaVersion: 1, connections: {} }))).toBe('connections must be an array of at most 8');
    const nine = Array.from({ length: 9 }, (_, i) => entry({ id: `c${i}` }));
    expect(reasonOf(file(nine))).toBe('connections must be an array of at most 8');
    expect(parseApiConnectionsFile({ raw: file(nine.slice(0, 8)), clientNamespace }).ok).toBe(true);
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
