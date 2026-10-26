import { expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { postHogBrowserContribution, POSTHOG_BROWSER_VERSION } from '../analytics-posthog/browser.js';

function fixture({ replay = false, surface = 'site', returningId = 'opaque-returning-visitor' }: { replay?: boolean; surface?: 'site' | 'admin'; returningId?: string } = {}) {
  const configs: Record<string, any>[] = [], retired: Record<string, any>[] = [], identified: string[] = [];
  let loads = 0, stopped = 0;
  const sdk = { init(_token: string, config: Record<string, any>) {
    configs.push(config);
    const instance = { stopSessionRecording() { stopped++; }, set_config(input: Record<string, any>) { retired.push(input); },
      identify(id: string) { identified.push(id); }, get_distinct_id() { return returningId; } };
    config.loaded(instance);
    return instance;
  } };
  const contribution = postHogBrowserContribution({ apiKey: ['fake', 'browser', 'token'].join('_'), host: 'https://collector.example', sessionReplay: replay,
    surface, attributes: { site_id: 'site-1' } });
  const factory = runInNewContext(`(${contribution.source})`, { location: { origin: 'https://site.example' } });
  const mode = factory({ loadSdk: async () => { loads++; return { default: sdk }; } });
  return { mode, configs, retired, identified, contribution, loads: () => loads, stopped: () => stopped };
}

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

it('uses a pinned SDK and does no SDK work while pending', async () => {
  const f = fixture(); f.mode('pending'); await flush();
  expect(f.loads()).toBe(0); expect(f.configs).toEqual([]);
  expect(f.contribution.source).toContain(`posthog-js@${POSTHOG_BROWSER_VERSION}/+esm`);
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
    $process_person_profile: true, $current_url: 'https://site.example/', $pathname: '/', site_id: 'site-1', surface: 'site' });
});

it('a late SDK load cannot resurrect the grant withdrawn while it was loading', async () => {
  const f = fixture(); f.mode('full'); f.mode('anonymous'); await flush();
  expect(f.configs).toHaveLength(1); expect(f.configs[0]!.cookieless_mode).toBe('always');
  expect(f.identified).toEqual([]);
});
