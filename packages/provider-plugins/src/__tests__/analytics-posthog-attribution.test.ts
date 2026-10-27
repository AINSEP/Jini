import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import type { ConsentState } from '@jini-ai/cookie-consent';
import { createPostHogProvider } from '../analytics-posthog/index.js';
import { postHogBrowserContribution } from '../analytics-posthog/browser.js';
import { postHogConsentContribution } from '../analytics-posthog/consent.js';
import { anonymousPageview, createPostHogConsentAdapter, sanitizeEvent } from '../analytics-posthog/consent-adapter.js';

const attributes = { site_id: 'site-1', release: 'web@abc123', environment: 'staging', project_id: 'private-project', site_slug: 'private-slug' };
const expected = { site_id: 'site-1', release: 'web@abc123', environment: 'staging' };
const base = { apiKey: 'phc_fixture', host: 'https://collector.example', sessionReplay: false };
const consent = { ...base, siteId: attributes.site_id, release: attributes.release, environment: attributes.environment, path: '/_consent/posthog' };
const location = { origin: 'https://site.example', pathname: '/account', hostname: 'site.example' };

it('wires host release and environment to both browser contributions while keeping other site metadata private', async () => {
  const resource = createPostHogProvider({ ...base, attribution: { attributes, groups: { site: 'site-1' } } });
  try {
    const browser = resource.port.browserAnalytics({ surface: 'site' });
    expect(browser.source).toContain('web@abc123');
    expect(browser.source).toContain('staging');
    expect(browser.source).not.toContain('private-project');
    expect(browser.source).not.toContain('private-slug');
    expect(resource.port.consentAdapter({ path: consent.path }).adapter.config).toEqual({
      ...postHogConsentContribution({ ...base, siteId: 'site-1', path: consent.path }).adapter.config,
      release: 'web@abc123', environment: 'staging',
    });
  } finally { await resource.dispose({}); }
});

for (const surface of ['site', 'admin'] as const) for (const mode of ['full', 'anonymous']) {
  it(`preserves only host-owned browser attribution for ${surface} ${mode} events`, async () => {
    const contribution = postHogBrowserContribution({ ...base, surface, attributes });
    const configs: Record<string, any>[] = [];
    const factory = runInNewContext(`(${contribution.source})`, { document: { cookie: '' }, localStorage: { removeItem() {} }, location });
    const setMode = factory({ loadSdk: async () => ({ default: { init(_token: string, config: Record<string, any>) {
      configs.push(config);
      return { stopSessionRecording() {}, set_config() {} };
    } } }) });
    setMode(mode);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    const event = configs[0]!.before_send({ event: '$pageview', properties: { release: 'forged-release', environment: 'forged-environment', site_id: 'forged-site', project_id: 'private-project' } });
    expect(event.properties).toMatchObject({ ...expected, surface });
    expect(event.properties).not.toHaveProperty('project_id');
    expect(contribution.source).not.toContain('private-project');
    expect(contribution.source).not.toContain('private-slug');
  });
}

it('carries trusted release metadata through full-consent SDK sanitization', async () => {
  const configs: Record<string, any>[] = [];
  const adapter = createPostHogConsentAdapter({ ports: { location, loadSdk: async () => ({ init(_token, config) {
    configs.push(config);
    return { set_config() {}, get_distinct_id: () => 'visitor:1', identify() {} };
  } }) } });
  await adapter.grant({ config: postHogConsentContribution(consent).adapter.config, state: { analyticsLevel: 'full' } as ConsentState, signal: new AbortController().signal });
  const event = configs[0]!.before_send({ event: '$pageview', properties: { release: 'forged-release', environment: 'forged-environment', project_id: 'private-project' } });
  expect(event.properties).toEqual({ ...expected, surface: 'site', $process_person_profile: true, $pathname: '/account', $current_url: 'https://site.example/account', $host: 'site.example' });
});

it('keeps release attribution in anonymous browser delivery and the authoritative anonymous collector rewrite', async () => {
  const sent: RequestInit[] = [];
  const request: typeof fetch = async (_url, init) => { sent.push(init!); return new Response('1'); };
  const contribution = postHogConsentContribution(consent, { request });
  const adapter = createPostHogConsentAdapter({ ports: { location, request, loadSdk: async () => { throw new Error('anonymous must not load SDK'); } } });
  await adapter.grant({ config: contribution.adapter.config, state: { analyticsLevel: 'anonymous' } as ConsentState, signal: new AbortController().signal });
  await contribution.http.handle({ method: 'POST', path: '/e/', contentType: 'application/json', analyticsLevel: 'anonymous',
    body: new TextEncoder().encode(JSON.stringify({ event: '$identify', properties: { release: 'forged-release', environment: 'forged-environment', project_id: 'private-project' } })) });
  expect(sent).toHaveLength(2);
  for (const init of sent) {
    const body = typeof init.body === 'string' ? init.body : Buffer.from(init.body as Uint8Array).toString();
    expect(JSON.parse(body)).toEqual({ api_key: 'phc_fixture', event: '$pageview', properties: {
      ...expected, surface: 'site', distinct_id: 'visitor:ephemeral', $process_person_profile: false, $geoip_disable: true,
    } });
  }
});

it('does not invent attribution when absent or accept untrusted event release metadata', () => {
  expect(JSON.parse(anonymousPageview({ apiKey: 'phc_fixture' })).properties).toEqual({
    distinct_id: 'visitor:ephemeral', $process_person_profile: false, $geoip_disable: true, surface: 'site',
  });
  const event = sanitizeEvent({ event: { properties: { release: 'forged-release', environment: 'forged-environment' } }, location });
  expect(event.properties).toEqual({ $process_person_profile: true, $pathname: '/account', $current_url: 'https://site.example/account', $host: 'site.example', surface: 'site' });
});

it('preserves deployment labels independently of a site id', () => {
  const contribution = postHogConsentContribution({ ...base, path: consent.path, release: 'web@abc123', environment: 'staging' });
  expect(contribution.adapter.config).not.toHaveProperty('siteId');
  expect(JSON.parse(anonymousPageview(contribution.adapter.config)).properties).toEqual({
    release: 'web@abc123', environment: 'staging', distinct_id: 'visitor:ephemeral', $process_person_profile: false, $geoip_disable: true, surface: 'site',
  });
});
