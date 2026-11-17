import { describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { renderOAuthCallbackPage, type OAuthCallbackPageCopy } from '../../src/callback-page.js';

type Reason = 'denied' | 'failed';
const copy: OAuthCallbackPageCopy<Reason> = {
  successHeading: 'Connected',
  successBody: 'You can close this window.',
  failureHeading: 'Couldn’t finish connecting',
  failureBodies: { denied: 'Declined by the provider.', failed: 'Something went wrong.' },
  defaultReason: 'failed',
};

function runScript(html: string, opener: 'present' | 'absent' | 'throws') {
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  expect(script).toBeTruthy();
  const messages: unknown[] = [];
  const timers: { callback: () => void; delay: number }[] = [];
  let closes = 0;
  const window = {
    opener: opener === 'absent' ? null : { postMessage(payload: unknown, origin: string) {
      messages.push([JSON.parse(JSON.stringify(payload)), origin]);
      if (opener === 'throws') throw new Error('opener unavailable');
    } },
    location: { origin: 'https://host.example' },
    close() { closes += 1; },
  };
  runInNewContext(script!, { window, setTimeout(callback: () => void, delay: number) { timers.push({ callback, delay }); } }, { timeout: 1_000 });
  return { messages, timers, window, closes: () => closes };
}

describe.each([true, false])('callback script, ok=%s', (ok) => {
  it.each(['present', 'absent', 'throws'] as const)('%s opener still schedules closing', (opener) => {
    const html = renderOAuthCallbackPage({ ok, messageType: 'flow:done', reason: 'denied', copy });
    const run = runScript(html, opener);
    expect(run.messages).toEqual(opener === 'absent' ? [] : [[ok ? { type: 'flow:done' } : { type: 'flow:done', reason: 'denied' }, 'https://host.example']]);
    expect(run.closes()).toBe(0);
    expect(run.timers).toHaveLength(1);
    expect(run.timers[0]!.delay).toBe(ok ? 400 : 2500);
    run.timers[0]!.callback();
    expect(run.closes()).toBe(1);
    run.window.close = () => { throw new Error('closing denied'); };
    expect(() => run.timers[0]!.callback()).not.toThrow();
  });
});

describe('renderOAuthCallbackPage copy', () => {
  it('renders the success and the per-reason failure copy', () => {
    expect(renderOAuthCallbackPage({ ok: true, messageType: 't', copy })).toContain('<h1>Connected</h1>');
    const denied = renderOAuthCallbackPage({ ok: false, messageType: 't', reason: 'denied', copy });
    expect(denied).toContain('<title>Couldn’t finish connecting</title>');
    expect(denied).toContain('Declined by the provider.');
  });

  it('falls back to the default reason when none or an unknown one is given', () => {
    for (const reason of [undefined, 'constructor', 'toString', '__proto__']) {
      const html = renderOAuthCallbackPage({ ok: false, messageType: 't', reason: reason as Reason | undefined, copy });
      expect(html).toContain('Something went wrong.');
      expect(runScript(html, 'present').messages).toEqual([[{ type: 't', reason: 'failed' }, 'https://host.example']]);
    }
  });

  it('honors language and close-delay options', () => {
    const html = renderOAuthCallbackPage({ ok: false, messageType: 't', copy }, { lang: 'fr', failureCloseMs: 10 });
    expect(html).toContain('<html lang="fr">');
    expect(runScript(html, 'absent').timers[0]!.delay).toBe(10);
  });
});

describe('renderOAuthCallbackPage markup safety', () => {
  const hostile = '</script><img src=x onerror=alert(1)>\u2028';
  it('keeps a hostile message type inside the script literal', () => {
    const html = renderOAuthCallbackPage({ ok: true, messageType: hostile, copy });
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).not.toContain('<img');
    expect(runScript(html, 'present').messages).toEqual([[{ type: hostile }, 'https://host.example']]);
  });

  it('escapes host copy as HTML text', () => {
    const html = renderOAuthCallbackPage({ ok: true, messageType: 't', copy: { ...copy, successHeading: '<b>&"\'' } });
    expect(html).toContain('<h1>&lt;b&gt;&amp;&quot;&#39;</h1>');
  });
});
