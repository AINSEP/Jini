import { expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { postHogBrowserContribution, POSTHOG_BROWSER_VERSION } from '../analytics-posthog/browser.js';

function fixture({ replay = false, surface = 'site', returningId = 'opaque-returning-visitor', path = '/account' }: { replay?: boolean; surface?: 'site' | 'admin'; returningId?: string; path?: string } = {}) {
  const configs: Record<string, any>[] = [], retired: Record<string, any>[] = [], identified: string[] = [];
  let loads = 0, stopped = 0;
  const sdk = { init(_token: string, config: Record<string, any>) {
    configs.push(config);
    const instance = { stopSessionRecording() { stopped++; }, set_config(input: Record<string, any>) { retired.push(input); },
      identify(id: string) { identified.push(id); }, get_distinct_id() { return returningId; } };
    config.loaded(instance);
    return instance;
  } };
  const contribution = postHogBrowserContribution({ apiKey: ['phc', 'fake', 'browser', 'token'].join('_'), host: 'https://collector.example', sessionReplay: replay,
    surface, attributes: { site_id: 'site-1' } });
  const removed: string[] = [], cookies: string[] = [];
  const document = { set cookie(value: string) { cookies.push(value); } };
  const factory = runInNewContext(`(${contribution.source})`, { document, localStorage: { removeItem: (name: string) => removed.push(name) },
    location: { origin: 'https://site.example', pathname: path, hostname: 'site.example' } });
  const mode = factory({ loadSdk: async () => { loads++; return { default: sdk }; } });
  return { mode, configs, retired, identified, contribution, removed, cookies, loads: () => loads, stopped: () => stopped };
}

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

it('refuses personal keys and credential-bearing hosts before producing public source', () => {
  const valid = { apiKey: ['phc', 'fixture'].join('_'), host: 'https://collector.example', sessionReplay: false, surface: 'site' as const, attributes: {} };
  expect(() => postHogBrowserContribution({ ...valid, apiKey: ['phx', 'private', 'fixture'].join('_') }))
    .toThrow(new TypeError('Use a PostHog project key starting with phc_, not a personal API key.'));
  const credentialHost = new URL(valid.host);
  credentialHost.username = ['fixture', 'user'].join('-');
  const usernameHost = credentialHost.href;
  credentialHost.password = ['fixture', 'password'].join('-');
  for (const host of [credentialHost.href, usernameHost, 'https://collector.example/?token=fixture', 'file:///collector', 'invalid']) {
    expect(() => postHogBrowserContribution({ ...valid, host })).toThrow(new TypeError('Use an HTTP or HTTPS host URL without credentials.'));
  }
  expect(postHogBrowserContribution(valid).origins).toEqual([]);
});

it('uses a pinned SDK and does no SDK work while pending', async () => {
  const f = fixture(); f.mode('pending'); await flush();
  expect(f.loads()).toBe(0); expect(f.configs).toEqual([]);
  expect(f.contribution.source).toContain(`/sdk-${POSTHOG_BROWSER_VERSION}.js`);
  expect(f.contribution.supportsStatic).toBe(false);
});

it('reject uses cookieless memory only, without identity, profiles or replay', async () => {
  const f = fixture({ replay: true }); f.mode('anonymous'); await flush();
  expect(f.configs).toHaveLength(1);
  expect(f.configs[0]).toMatchObject({ cookieless_mode: 'always', persistence: 'memory', disable_persistence: true,
    person_profiles: 'never', disable_session_recording: true, autocapture: false });
  expect(f.identified).toEqual([]);
  const safe = f.configs[0]!.before_send({ event: '$pageview', properties: { distinct_id: 'old-id', email: 'private', $current_url: 'https://site.example/?secret', $elements: ['private'] } });
  expect(safe.properties).toEqual({ distinct_id: '$posthog_cookieless', $process_person_profile: false, $current_url: 'https://site.example/', $pathname: '/', site_id: 'site-1', surface: 'site' });
});

it('full consent enables autocapture and returning identity; replay still defaults off', async () => {
  const f = fixture(); f.mode('full'); await flush();
  expect(f.configs[0]).toMatchObject({ persistence: 'localStorage+cookie', disable_persistence: false, disable_session_recording: true, person_profiles: 'identified_only' });
  expect(f.configs[0]!.autocapture).toEqual({ capture_copied_text: false });
  expect(f.identified).toEqual(['visitor:opaque-returning-visitor']);
  const replay = fixture({ replay: true }); replay.mode('full'); await flush();
  expect(replay.configs[0]!.disable_session_recording).toBe(false);
});

it('withdrawal stops replay, removes persisted data, blocks retired listeners and switches live', async () => {
  const f = fixture({ replay: true }); f.mode('full'); await flush(); f.mode('anonymous'); await flush();
  expect(f.stopped()).toBe(1);
  expect(f.retired[0]).toMatchObject({ disable_persistence: true, autocapture: false, disable_session_recording: true });
  expect(f.retired[0]!.before_send({ event: '$pageview' })).toBe(null);
  expect(f.configs).toHaveLength(2);
  expect(f.configs[1]!.cookieless_mode).toBe('always');
  expect(f.loads()).toBe(1);
  f.mode('full'); await flush(); expect(f.configs).toHaveLength(3);
  expect(f.identified).toEqual(['visitor:opaque-returning-visitor', 'visitor:opaque-returning-visitor']);
});

it('preserves returning opaque identity and separates admin persistence from site persistence', async () => {
  const site = fixture({ returningId: 'visitor:already-identified' });
  const admin = fixture({ surface: 'admin' });
  site.mode('full'); admin.mode('full'); await flush();
  expect(site.identified).toEqual(['visitor:already-identified']);
  expect(site.configs[0]!.persistence_name).toBe('jini_site_site-1');
  expect(admin.configs[0]!.persistence_name).toBe('jini_admin_site-1');
  expect(site.configs[0]).toMatchObject({ request_batching: false, mask_all_element_attributes: true, mask_all_text: true });
});

it('full autocapture strips DOM content, URLs and input values before delivery', async () => {
  const f = fixture(); f.mode('full'); await flush();
  const event = f.configs[0]!.before_send({ event: '$autocapture', properties: {
    distinct_id: 'visitor:opaque', $event_type: 'click', $el_tag_name: 'button',
    $elements: [{ text: 'Private content' }], $current_url: 'https://site.example/account?token=private',
    $referrer: 'https://referrer.example/private', value: 'private input',
  } });
  expect(event.properties).toEqual({ distinct_id: 'visitor:opaque', $event_type: 'click', $el_tag_name: 'button',
    $process_person_profile: true, $current_url: 'https://site.example/account', $pathname: '/account', $host: 'site.example', $elements: [], site_id: 'site-1', surface: 'site' });
});

it('a late SDK load cannot resurrect the grant withdrawn while it was loading', async () => {
  const f = fixture(); f.mode('full'); f.mode('anonymous'); await flush();
  expect(f.configs).toHaveLength(1); expect(f.configs[0]!.cookieless_mode).toBe('always');
  expect(f.identified).toEqual([]);
});

it('full mode preserves structural autocapture without DOM text, identifiers or query PII', async () => {
  const f = fixture(); f.mode('full'); await flush();
  const event = f.configs[0]!.before_send({ event: '$autocapture', properties: {
    $elements_chain: 'button#private-email:nth-child(2)[text="private"];div.secret:nth-of-type(3)',
    $elements: [{ tag_name: 'button', nth_child: 2, nth_of_type: 1, text: 'private', attr__id: 'private' }],
    $pathname: '/', $current_url: 'https://site.example/?token=private#private', consentProof: { receiptId: 'private' },
  } });
  expect(event.properties).toEqual({ $process_person_profile: true, $current_url: 'https://site.example/account',
    $pathname: '/account', $host: 'site.example', $elements_chain: 'button:nth-child(2);div:nth-of-type(3)',
    $elements: [{ tag_name: 'button', nth_child: 2, nth_of_type: 1 }], site_id: 'site-1', surface: 'site' });
});

it('anonymous first load clears both the configured and legacy persistence before SDK startup', async () => {
  const f = fixture(); f.mode('anonymous');
  expect(f.removed).toEqual(['ph_jini_site_site-1', 'ph_phc_fake_browser_token_posthog']);
  expect(f.cookies).toEqual([
    'ph_jini_site_site-1=; Max-Age=0; Path=/', 'ph_jini_site_site-1=; Max-Age=0; Path=/; Domain=site.example',
    'ph_phc_fake_browser_token_posthog=; Max-Age=0; Path=/', 'ph_phc_fake_browser_token_posthog=; Max-Age=0; Path=/; Domain=site.example',
  ]);
  expect(f.configs).toHaveLength(0);
  await flush(); expect(f.configs).toHaveLength(1);
});

it('same-origin adapter serves the pinned SDK and relays only collector paths with no browser headers', async () => {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const contribution = postHogBrowserContribution({ apiKey: 'phc_fixture', host: 'https://collector.example', sessionReplay: false,
    surface: 'site', attributes: { site_id: 'site-1', project_id: 'private-project', site_slug: 'private-slug', release: 'web@abc123', environment: 'staging' } }, {
    loadAsset: async () => 'export default fixture;', request: async (url, init) => {
      requests.push({ url: String(url), init }); return new Response('1');
    },
  });
  expect(contribution.origins).toEqual([]);
  for (const privateValue of ['private-project', 'private-slug', 'cdn.jsdelivr.net', 'collector.example']) expect(contribution.source).not.toContain(privateValue);
  expect(contribution.source).toContain('web@abc123');
  expect(contribution.source).toContain('staging');
  expect(await contribution.http!.handle({ method: 'GET', path: `/sdk-${POSTHOG_BROWSER_VERSION}.js`, body: new Uint8Array(), contentType: '' }))
    .toEqual({ status: 200, body: 'export default fixture;', contentType: 'text/javascript; charset=utf-8', cacheControl: 'public, max-age=31536000, immutable' });
  const body = new TextEncoder().encode('fixture-event');
  expect(await contribution.http!.handle({ method: 'POST', path: '/e/', body, contentType: 'text/plain' })).toEqual({ status: 200, body: '1' });
  expect(requests).toHaveLength(1);
  expect(requests[0]!.url).toBe('https://collector.example/e/?ip=0');
  expect(requests[0]!.init!.headers).toEqual({ 'content-type': 'text/plain' });
  expect(requests[0]!.init!.redirect).toBe('error');
  for (const path of ['/../other', '//evil.example', '/flags/', '/static/array.js']) {
    expect(await contribution.http!.handle({ method: 'POST', path, body, contentType: 'text/plain' })).toEqual({ status: 404, body: '' });
  }
  expect(requests).toHaveLength(1);
});

it('full pageviews preserve page paths but redact email-bearing path segments', async () => {
  const f = fixture({ path: '/members/visitor%40example.com/settings' }); f.mode('full'); await flush();
  const event = f.configs[0]!.before_send({ event: '$pageview', properties: { $current_url: 'https://site.example/?token=private#secret' } });
  expect(event.properties.$pathname).toBe('/members/:redacted/settings');
  expect(event.properties.$current_url).toBe('https://site.example/members/:redacted/settings');
  expect(JSON.stringify(event)).not.toMatch(/visitor%40|token=|#secret/);
});
