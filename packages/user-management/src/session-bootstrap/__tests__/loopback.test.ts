import { describe, expect, it, vi } from 'vitest';
import { assertLoopbackHttpUrl } from '../loopback.js';

describe('assertLoopbackHttpUrl', () => {
  it.each([
    'http://127.0.0.1:3001',
    'http://127.0.0.1:3001/session/',
    'http://127.0.0.1:65535/',
    'http://[::1]:1',
    'http://[::1]:3001/session/',
    'http://a@127.0.0.1',
  ])('returns the parsed URL for %s', (url) => {
    const message = vi.fn(() => 'unexpected refusal');
    const parsed = assertLoopbackHttpUrl({ url }, { message });
    expect(parsed).toBeInstanceOf(URL);
    expect(parsed.href).toBe(new URL(url).href);
    expect(message).not.toHaveBeenCalled();
  });

  it.each([
    { url: 'http://::1', reason: 'invalid', detail: 'http://::1' },
    { url: 'not a url', reason: 'invalid', detail: 'not a url' },
    { url: 'https://127.0.0.1', reason: 'scheme', detail: 'https:' },
    { url: 'https://127.0.0.1:3001/', reason: 'scheme', detail: 'https:' },
    { url: 'file:///etc/passwd', reason: 'scheme', detail: 'file:' },
    { url: 'ftp://127.0.0.1/', reason: 'scheme', detail: 'ftp:' },
    { url: 'http://localhost', reason: 'host', detail: 'localhost' },
    { url: 'http://localhost:3001/session/', reason: 'host', detail: 'localhost' },
    { url: 'http://192.168.1.2', reason: 'host', detail: '192.168.1.2' },
    { url: 'http://192.168.1.10:3001/session/', reason: 'host', detail: '192.168.1.10' },
    { url: 'http://10.0.0.5:3001/session/', reason: 'host', detail: '10.0.0.5' },
    { url: 'http://0.0.0.0:3001/session/', reason: 'host', detail: '0.0.0.0' },
    { url: 'http://evil.example.com/session/', reason: 'host', detail: 'evil.example.com' },
    { url: 'http://127.0.0.1.evil.test', reason: 'host', detail: '127.0.0.1.evil.test' },
    { url: 'http://127.0.0.1.evil.example.com/session/', reason: 'host', detail: '127.0.0.1.evil.example.com' },
    { url: 'http://not-127.0.0.1/session/', reason: 'host', detail: 'not-127.0.0.1' },
    { url: 'http://127.0.0.1@evil.example.com/session/', reason: 'host', detail: 'evil.example.com' },
  ])('refuses $url with the host message port', ({ url, reason, detail }) => {
    const message = vi.fn(() => `refused ${reason}: ${detail}`);
    expect(() => assertLoopbackHttpUrl({ url }, { message })).toThrow(`refused ${reason}: ${detail}`);
    expect(message).toHaveBeenCalledTimes(1);
    expect(message).toHaveBeenCalledWith({ reason, detail });
  });

  it.each([
    'http://::1', 'https://127.0.0.1', 'http://localhost',
  ])('uses a neutral default refusal for %s', (url) => {
    expect(() => assertLoopbackHttpUrl({ url })).toThrow(/^loopback guard refused: /);
  });
});
