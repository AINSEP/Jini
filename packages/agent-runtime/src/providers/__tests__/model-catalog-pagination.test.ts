import { describe, expect, it } from 'vitest';
import { listProviderModels } from '../model-catalog.js';
const noDns = async () => [{ address: '93.184.216.34', family: 4 }];
describe('provider catalog pagination through injected HTTP', () => {
  it('follows Anthropic cursors and deduplicates all pages', async () => {
    const urls: string[] = [];
    const fetchFn: typeof fetch = async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify(urls.length === 1
        ? { data: [{ id: 'claude-a', display_name: 'Claude A' }], has_more: true, last_id: 'claude-a' }
        : { data: [{ id: 'claude-a', display_name: 'Claude A' }, { id: 'claude-b', display_name: 'Claude B' }], has_more: false }), { status: 200 });
    };
    const result = await listProviderModels({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'test-secret' }, { dnsLookup: noDns, fetchFn });
    expect(result.models).toEqual([{ id: 'claude-a', label: 'Claude A' }, { id: 'claude-b', label: 'Claude B' }]);
    expect(urls).toHaveLength(2); expect(new URL(urls[1]!).searchParams.get('after_id')).toBe('claude-a');
    expect(JSON.stringify(result)).not.toContain('test-secret');
  });
  it('keeps the Google BYOK provider and follows nextPageToken', async () => {
    const urls: string[] = [];
    const fetchFn: typeof fetch = async (url) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ models: [{ name: `models/gemini-${urls.length}`, displayName: `Gemini ${urls.length}`, supportedGenerationMethods: ['generateContent'] }], ...(urls.length === 1 ? { nextPageToken: 'next' } : {}) }));
    };
    const result = await listProviderModels({ protocol: 'google', baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'test-secret' }, { dnsLookup: noDns, fetchFn });
    expect(result.models?.map((row) => row.id)).toEqual(['gemini-1', 'gemini-2']);
    expect(new URL(urls[1]!).searchParams.get('pageToken')).toBe('next');
  });
  it('refuses a pagination loop without exposing cursor values', async () => {
    const fetchFn: typeof fetch = async () => new Response(JSON.stringify({ data: [{ id: 'claude-a' }], has_more: true, last_id: 'private-cursor' }));
    const result = await listProviderModels({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'test-secret' }, { dnsLookup: noDns, fetchFn });
    expect(result.ok).toBe(false); expect(result.detail).toBe('Provider repeated a pagination cursor.');
    expect(JSON.stringify(result)).not.toContain('private-cursor');
  });
});
