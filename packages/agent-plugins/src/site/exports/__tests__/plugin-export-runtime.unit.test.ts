import { expect, test, vi } from 'vitest';
import type { AgentPluginExport } from '@jini-ai/core/contracts/site/agent-plugins-manifest';
import type { LoginProvider } from '@jini-ai/core/contracts/site/user-management-server';
import { PluginEmbedValidationError } from '../diagnostics.js';
import { createPluginExportRuntime } from '../runtime.js';
import type { PluginExportPackage, PluginExportSource } from '../source.js';

const workspaceId = 'site-b';
const pkg = { pluginId: 'login-card', packageRoot: '/trusted/login-card/digest' };
const definition: AgentPluginExport = {
  template: 'exports/card.html', styles: 'exports/theme.css', assets: { logo: 'exports/logo.png' },
  scripts: ['exports/behavior.js', 'https://scripts.example/widget.js'],
  externalHosts: { script: ['https://scripts.example'], frame: ['https://frames.example'], connect: ['https://api.example'] },
  props: { type: 'object', properties: {} },
  consent: 'functional', staticExport: 'full', version: 3, minVersion: 2,
  aliases: ['signin'], hostLinks: { signIn: 'member-login:member' },
};
const owner: PluginExportPackage = {
  plugin: pkg, id: 'acme/login-card', displayName: 'Login card', renamedFrom: ['old/login-card'],
  enabled: true, exports: { card: definition },
};
const login: LoginProvider = {
  id: 'member', label: 'Member login', pluginId: 'login-card', configurationVersion: 'ready-2',
  issuer: 'https://login.example', authorizationEndpoint: 'https://login.example/auth',
  tokenEndpoint: 'https://login.example/token', jwksUri: 'https://login.example/keys',
  scopes: ['openid'], signingAlgorithm: 'RS256', clientAuthentication: 'client_secret_basic',
  credentialLabel: 'Member client', credentialCardTarget: 'member', pkce: 'S256',
};
const template = '<a href="{{host.signIn}}">Sign in</a>';
const config = { plugin: 'old/login-card', component: 'signin', version: 2 };

function rig(packages: readonly PluginExportPackage[] = [owner], providers: readonly LoginProvider[] = [login], consentOff?: boolean) {
  let current = packages;
  const source: PluginExportSource = {
    list: vi.fn<PluginExportSource['list']>(async input => {
      if (input.workspaceId !== workspaceId) throw new Error('wrong workspace');
      return current;
    }),
    readFile: vi.fn<PluginExportSource['readFile']>(async ({ plugin, filename }) => {
      if (plugin !== pkg || filename !== 'exports/card.html') throw new Error('wrong template request');
      return template;
    }),
    readAsset: async () => { throw new Error('runtime must not read asset contents'); },
  };
  const listProviders = vi.fn(async (input: { workspaceId: string }) => {
    if (input.workspaceId !== workspaceId) throw new Error('wrong workspace');
    return providers;
  });
  const memberLoginStart = vi.fn((input: { workspaceId: string; providerId: string }) => {
    if (input.workspaceId !== workspaceId || input.providerId !== 'member') throw new Error('wrong member link');
    return '/members/member/start';
  });
  const runtime = createPluginExportRuntime({
    workspaceId, source, filesPrefix: '/plugin-files', listProviders, memberLoginStart,
    markersOfType: ({ html, type }) => {
      if (type !== 'plugin') throw new Error('wrong marker type');
      return html === '' ? [] : (JSON.parse(html) as Readonly<Record<string, unknown>>[]).map(config => ({ config }));
    },
    embedMarkerSnippetFromConfig: ({ config }) => JSON.stringify(config),
    ...(consentOff === undefined ? {} : { embedConsentOff: () => consentOff }),
  });
  return { runtime, source, listProviders, memberLoginStart, setPackages(next: readonly PluginExportPackage[]) { current = next; } };
}

const fileBase = '/plugin-files/login-card/card/exports/';
const hosts = { script: ['https://scripts.example'], frame: ['https://frames.example'], connect: ['https://api.example'] };
const css = '<link rel="stylesheet" href="' + fileBase + 'theme.css">';
const preload = '<link rel="preload" as="image" href="' + fileBase + 'logo.png">';

test('renders canonical exports with an owner-bound login, deduped consent-gated head and scoped hosts', async () => {
  const f = rig();
  const page = f.runtime.forRender({ mode: 'live' });
  const input = { workspaceId, config };
  const expected = {
    plugin: 'acme/login-card', component: 'card', version: 3, minVersion: 2, consent: 'functional', consentOff: false,
    frameHosts: ['https://frames.example'], scriptData: true, template, props: {},
    host: { signIn: '/members/member/start', assets: { logo: fileBase + 'logo.png' } },
  };
  await expect(page.resolve(input)).resolves.toEqual(expected);
  await expect(page.resolve(input)).resolves.toEqual(expected);
  expect(f.source.list).toHaveBeenCalledExactlyOnceWith({ workspaceId });
  expect(f.listProviders).toHaveBeenCalledExactlyOnceWith({ workspaceId });
  expect(f.source.readFile).toHaveBeenNthCalledWith(2, { plugin: pkg, filename: 'exports/card.html' });
  expect(page.headHtml({})).toBe([
    css, '<script type="text/plain" data-consent-category="functional" data-src="' + fileBase + 'behavior.js"></script>',
    '<script type="text/plain" data-consent-category="functional" data-src="https://scripts.example/widget.js"></script>',
  ].join('\n'));
  expect(page.declaredHosts({})).toEqual(hosts);

  f.setPackages([{ ...owner, enabled: false }]);
  await expect(f.runtime.forRender({ mode: 'live' }).resolve(input)).resolves.toBeUndefined();
  await expect(f.runtime.declaredHosts({ workspaceId })).resolves.toEqual({ script: [], frame: [], connect: [] });
});

test.each(['fallback-only', 'link-only', 'full'] as const)('static %s ships only the permitted template, assets and scripts', async staticExport => {
  const f = rig([{ ...owner, exports: { card: { ...definition, staticExport } } }], [login], true);
  const page = f.runtime.forRender({ mode: 'static' });
  const result = await page.resolve({ workspaceId, config });
  if (staticExport === 'fallback-only') {
    expect(result).toBeUndefined();
    expect(f.source.readFile).not.toHaveBeenCalled();
    expect(f.memberLoginStart).not.toHaveBeenCalled();
  } else {
    expect(result).toMatchObject({ template, consentOff: true });
    expect(f.source.readFile).toHaveBeenCalledExactlyOnceWith({ plugin: pkg, filename: 'exports/card.html' });
  }
  expect(page.headHtml({})).toBe((staticExport === 'full' ? [
    css, preload, '<script src="' + fileBase + 'behavior.js" defer></script>',
    '<script src="https://scripts.example/widget.js" defer></script>',
  ] : [css, preload]).join('\n'));
});

test('a ready login with the right id but another plugin owner cannot satisfy the slot', async () => {
  const f = rig([owner], [{ ...login, pluginId: 'other-card' }]);
  const page = f.runtime.forRender({ mode: 'live' });
  await expect(page.resolve({ workspaceId, config })).resolves.toBeUndefined();
  expect(f.memberLoginStart).not.toHaveBeenCalled();
  expect(f.source.readFile).not.toHaveBeenCalled();
  expect(page.headHtml({})).toBe(css);
  await expect(f.runtime.validateHtml({ workspaceId, html: JSON.stringify([config]) })).resolves.toEqual([
    { code: 'PLUGIN_HOST_UNAVAILABLE', message: 'Plugin sign-in is not configured or unavailable; visitors see your fallback.' },
  ]);
});

test('keeps savable diagnostics distinct and checks version before incompatible props', async () => {
  const f = rig([owner, { ...owner, id: 'disabled/card', renamedFrom: [], enabled: false }]);
  await expect(f.runtime.validateHtml({ workspaceId, html: JSON.stringify([
    { ...config, plugin: 'missing' }, { ...config, plugin: 'disabled/card' }, { ...config, component: 'missing' },
    { ...config, version: '2' }, { ...config, version: 4, props: { unexpected: true } }, { ...config, version: undefined },
    config,
  ]) })).resolves.toEqual([
    { code: 'PLUGIN_UNAVAILABLE', message: 'Plugin is unknown or unavailable; visitors see your fallback.' },
    { code: 'PLUGIN_DISABLED', message: 'Plugin is off; visitors see your fallback.' },
    { code: 'COMPONENT_UNAVAILABLE', message: 'Plugin component is unknown or ambiguous; visitors see your fallback.' },
    { code: 'PLUGIN_VERSION_INVALID', message: 'Plugin contract version must be a positive integer; visitors see your fallback.' },
    { code: 'PLUGIN_VERSION_NEWER', message: 'Page needs plugin v4; visitors see your fallback.' },
    { code: 'PLUGIN_VERSION_RETIRED', message: 'Contract v1 retired; visitors see your fallback.' },
  ]);
  await expect(f.runtime.validateHtml({ workspaceId, html: JSON.stringify([{ ...config, props: { unexpected: 'hidden' } }]) }))
    .rejects.toMatchObject({ name: 'PluginEmbedValidationError', code: 'PLUGIN_EMBED_INVALID_PROPS' });
  await expect(f.runtime.forRender({ mode: 'live' }).resolve({ workspaceId, config: { ...config, version: 0 } })).resolves.toBeUndefined();
  expect(f.source.readFile).not.toHaveBeenCalled();
});

test('ambiguous aliases are refused even if the second owner is disabled', async () => {
  const f = rig([owner, { ...owner, id: config.plugin, renamedFrom: [], enabled: false }]);
  await expect(f.runtime.validateHtml({ workspaceId, html: JSON.stringify([config]) })).resolves.toEqual([
    { code: 'PLUGIN_UNAVAILABLE', message: 'Plugin identity is ambiguous; visitors see your fallback.' },
  ]);
});

test('foreign workspace and empty HTML do not read the catalog or provider data', async () => {
  const f = rig();
  const other = { workspaceId: 'other-site' };
  await expect(f.runtime.validateHtml({ ...other, html: '' })).rejects.toThrow(new PluginEmbedValidationError({ message: 'Plugin embed workspace does not match this site.' }));
  await expect(f.runtime.validateHtml({ workspaceId, html: '' })).resolves.toEqual([]);
  await expect(f.runtime.forRender({ mode: 'live' }).resolve({ ...other, config })).resolves.toBeUndefined();
  await expect(f.runtime.catalog(other)).resolves.toEqual(new Map());
  await expect(f.runtime.declaredHosts(other)).resolves.toEqual({ script: [], frame: [], connect: [] });
  expect(f.source.list).not.toHaveBeenCalled();
  expect(f.listProviders).not.toHaveBeenCalled();
});

test('advertises canonical snippets only for ready exports, not contracts with required props or unrecognized host links', async () => {
  const props = { type: 'object', properties: { label: { type: 'string' } }, required: ['label'] } as const;
  const f = rig([{ ...owner, exports: {
    card: definition, labeled: { ...definition, props },
    unsupported: { ...definition, hostLinks: { unsupported: 'unsupported-capability' } },
  } }]);
  const rows = (await f.runtime.catalog({ workspaceId })).get('login-card');
  expect(rows?.map(({ component, availability, snippet }) => ({ component, availability, snippet }))).toEqual([
    { component: 'card', availability: 'ready', snippet: '{"type":"plugin","plugin":"acme/login-card","component":"card","version":3,"props":{}}' },
    { component: 'labeled', availability: 'props-required', snippet: null },
    { component: 'unsupported', availability: 'host-unavailable', snippet: null },
  ]);
  await expect(f.runtime.declaredHosts({ workspaceId })).resolves.toEqual(hosts);
  expect(f.source.readFile).not.toHaveBeenCalled();
});

test('an export with no host links or optional resources still renders when provider readiness fails', async () => {
  const independent: AgentPluginExport = {
    template: 'exports/card.html', props: { type: 'object' }, consent: 'necessary', staticExport: 'full', version: 1,
  };
  const f = rig([{ ...owner, exports: { card: independent } }]);
  f.listProviders.mockRejectedValue(new Error('login provider registry unavailable'));
  const config = { plugin: 'acme/login-card', component: 'card' };
  const page = f.runtime.forRender({ mode: 'live' });
  await expect(page.resolve({ config: { ...config, props: {} }, workspaceId })).resolves.toEqual({
    plugin: 'acme/login-card', component: 'card', version: 1, consent: 'necessary', consentOff: false,
    frameHosts: [], scriptData: false, template, props: {}, host: { assets: {} },
  });
  expect(page.headHtml({})).toBe('');
  expect(page.declaredHosts({})).toEqual({ script: [], frame: [], connect: [] });
  await expect(f.runtime.validateHtml({ workspaceId, html: JSON.stringify([config]) })).resolves.toEqual([]);
  expect((await f.runtime.catalog({ workspaceId })).get('login-card')).toMatchObject([{ component: 'card', minVersion: 1, availability: 'ready' }]);
});
