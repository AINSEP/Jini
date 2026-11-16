import { describe, expect, it } from 'vitest';
import { asApiConnectionHooksModule, checkApiConnectionClientNamespace, parseApiConnectionsFile } from '../index.js';

const ns = 'ACME_';
const web = { clientIdEnv: 'ACME_SHOP_OAUTH_WEB_CLIENT_ID' };
const file = (connections: unknown) => JSON.stringify({ schemaVersion: 1, connections });
const entry = (over: Record<string, unknown> = {}) => ({ id: 'account', module: 'hooks.mjs', clients: { web }, ...over });
const reasonOf = (raw: string) => { const p = parseApiConnectionsFile({ raw, clientNamespace: ns }); return p.ok ? '' : p.reason; };
const ok = (raw: string) => { const p = parseApiConnectionsFile({ raw, clientNamespace: ns }); if (!p.ok) throw new Error(p.reason); return p.descriptors; };

describe('top-level and entry shape', () => {
  it('refuses a wrong schemaVersion, a non-object root and a non-array or oversized connections list', () => {
    expect(reasonOf('[]')).toBe('schemaVersion must be 1');
    expect(reasonOf('null')).toBe('schemaVersion must be 1');
    expect(reasonOf(JSON.stringify({ schemaVersion: 2, connections: [] }))).toBe('schemaVersion must be 1');
    expect(reasonOf(file({}))).toMatch(/^connections must be an array of at most \d+$/);
    expect(reasonOf(file(Array.from({ length: 1000 }, (_, i) => entry({ id: `c-${i}` }))))).toMatch(/^connections must be an array of at most \d+$/);
  });

  it('refuses non-object entries and non-object clients', () => {
    expect(reasonOf(file(['x']))).toBe('connections[0] must be an object');
    expect(reasonOf(file([[]]))).toBe('connections[0] must be an object');
    expect(reasonOf(file([entry({ clients: [] })]))).toBe('connections[0].clients must be an object');
    expect(reasonOf(file([entry({ clients: null })]))).toBe('connections[0].clients must be an object');
  });

  it('refuses a bad id or module with the exact rule', () => {
    expect(reasonOf(file([entry({ id: 'Bad_Id' })]))).toBe('connections[0].id must be a lowercase hyphenated id');
    expect(reasonOf(file([entry({ id: 5 })]))).toBe('connections[0].id must be a lowercase hyphenated id');
    expect(reasonOf(file([entry({ id: 'a'.repeat(65) })]))).toBe('connections[0].id must be a lowercase hyphenated id');
    expect(reasonOf(file([entry({ module: 'hooks.js' })]))).toBe('connections[0].module must be a relative path ending in .mjs');
    expect(reasonOf(file([entry({ module: '/abs/hooks.mjs' })]))).toBe('connections[0].module must be a relative path ending in .mjs');
    expect(reasonOf(file([entry({ module: 7 })]))).toBe('connections[0].module must be a relative path ending in .mjs');
  });
});

describe('client configs', () => {
  it('refuses a non-object client and reports a bad desktop client even when web is fine', () => {
    expect(reasonOf(file([entry({ clients: { web: 'x' } })]))).toBe('connections[0].clients.web must be an object');
    expect(reasonOf(file([entry({ clients: { web, desktop: [] } })]))).toBe('connections[0].clients.desktop must be an object');
    expect(reasonOf(file([entry({ clients: { desktop: { clientIdEnv: 'ACME_X_CLIENT_SECRET' } } })]))).toBe('connections[0].clients.desktop.clientIdEnv must name a ACME_…_CLIENT_ID setting');
  });

  it('accepts a web-and-desktop pair with optional secret and redirect origins', () => {
    const [d] = ok(file([entry({ clients: {
      web: { clientIdEnv: 'ACME_SHOP_OAUTH_WEB_CLIENT_ID', redirectOrigins: ['https://app.example.test'] },
      desktop: { clientIdEnv: 'ACME_SHOP_OAUTH_DESKTOP_CLIENT_ID', clientSecretEnv: 'ACME_SHOP_OAUTH_DESKTOP_CLIENT_SECRET' },
    } })]));
    expect(d!.clients).toEqual({
      web: { clientIdEnv: 'ACME_SHOP_OAUTH_WEB_CLIENT_ID', redirectOrigins: ['https://app.example.test'] },
      desktop: { clientIdEnv: 'ACME_SHOP_OAUTH_DESKTOP_CLIENT_ID', clientSecretEnv: 'ACME_SHOP_OAUTH_DESKTOP_CLIENT_SECRET' },
    });
  });

  it('keeps only the runtime clients that were declared', () => {
    const desktop = { clientIdEnv: 'ACME_SHOP_OAUTH_DESKTOP_CLIENT_ID' };
    expect(ok(file([entry({ clients: { desktop } })]))[0]!.clients).toEqual({ desktop });
    expect(ok(file([entry({ clients: {} })]))[0]!.clients).toEqual({});
  });

  it('refuses redirect origins that are not bare origins, not a list, or too many', () => {
    const bad = (redirectOrigins: unknown) => reasonOf(file([entry({ clients: { web: { ...web, redirectOrigins } } })]));
    const message = 'connections[0].clients.web.redirectOrigins must be a list of origins';
    expect(bad('https://a.test')).toBe(message);
    expect(bad(['https://a.test/path'])).toBe(message);
    expect(bad(['not a url'])).toBe(message);
    expect(bad([5])).toBe(message);
    expect(bad(Array.from({ length: 50 }, (_, i) => `https://a${i}.test`))).toBe(message);
  });

  it('refuses an env name outside the SECRET suffix or with a lowercase remainder', () => {
    expect(reasonOf(file([entry({ clients: { web: { ...web, clientSecretEnv: 'ACME_SHOP_OAUTH_WEB_CLIENT_ID' } } })]))).toContain('clientSecretEnv must name');
    expect(reasonOf(file([entry({ clients: { web: { clientIdEnv: 'ACME_lower_ID' } } })]))).toContain('clientIdEnv must name');
    expect(reasonOf(file([entry({ clients: { web: { clientIdEnv: 42 } } })]))).toContain('clientIdEnv must name');
  });
});

describe('host-read lists', () => {
  it('accepts bounded scope sets, https api origins and byoClient', () => {
    const [d] = ok(file([entry({ scopeSets: ['read'], apiOrigins: ['https://api.example.test'], byoClient: true })]));
    expect(d).toMatchObject({ scopeSets: ['read'], apiOrigins: ['https://api.example.test'], byoClient: true });
    expect(d!.descriptor).toEqual({});
  });

  it('refuses malformed scope sets, non-https or malformed api origins, and a non-boolean byoClient', () => {
    expect(reasonOf(file([entry({ scopeSets: 'read' })]))).toMatch(/^connections\[0\]\.scopeSets must be at most \d+ short ids$/);
    expect(reasonOf(file([entry({ scopeSets: [5] })]))).toMatch(/scopeSets must be at most/);
    expect(reasonOf(file([entry({ scopeSets: ['Has Space'] })]))).toMatch(/scopeSets must be at most/);
    expect(reasonOf(file([entry({ scopeSets: Array.from({ length: 99 }, (_, i) => `s${i}`) })]))).toMatch(/scopeSets must be at most/);
    expect(reasonOf(file([entry({ apiOrigins: ['http://api.example.test'] })]))).toMatch(/^connections\[0\]\.apiOrigins must be at most \d+ https:\/\/ origins$/);
    expect(reasonOf(file([entry({ apiOrigins: ['https://api.example.test/x'] })]))).toMatch(/apiOrigins must be at most/);
    expect(reasonOf(file([entry({ apiOrigins: 'https://api.example.test' })]))).toMatch(/apiOrigins must be at most/);
    expect(reasonOf(file([entry({ byoClient: 'yes' })]))).toBe('connections[0].byoClient must be true or false');
  });
});

describe('hooks module and namespace checks', () => {
  it('accepts a module with createHooks and names the problem otherwise', () => {
    const module = { createHooks: () => ({}) };
    expect(asApiConnectionHooksModule({ exported: module })).toBe(module);
    expect(asApiConnectionHooksModule({ exported: {} })).toBe('its module has no createHooks() function');
    expect(asApiConnectionHooksModule({ exported: { createHooks: 1 } })).toBe('its module has no createHooks() function');
    expect(asApiConnectionHooksModule({ exported: [] })).toBe('its module has no createHooks() function');
    expect(asApiConnectionHooksModule({ exported: null })).toBe('its module has no createHooks() function');
  });

  it('keeps each plugin in its own encoded namespace', () => {
    const clients = { web: { clientIdEnv: 'ACME_ACME_OFFICE_OAUTH_WEB_CLIENT_ID', clientSecretEnv: 'ACME_ACME_OFFICE_OAUTH_WEB_CLIENT_SECRET' } };
    expect(() => checkApiConnectionClientNamespace({ pluginId: 'acme-office', clients, clientNamespace: ns })).not.toThrow();
    expect(() => checkApiConnectionClientNamespace({ pluginId: 'acme.office', clients, clientNamespace: ns })).toThrow("Client settings must belong to this plugin's ACME_ACME__OFFICE_ namespace.");
    expect(() => checkApiConnectionClientNamespace({ pluginId: 'acme-office', clients: { web: { clientIdEnv: 'ACME_ACME_OFFICE_OAUTH_WEB_CLIENT_ID', clientSecretEnv: 'ACME_ACME_OFFICE_OAUTH_DESKTOP_CLIENT_SECRET' } }, clientNamespace: ns })).toThrow('namespace');
    expect(() => checkApiConnectionClientNamespace({ pluginId: 'acme-office', clients: {}, clientNamespace: ns })).not.toThrow();
  });
});
