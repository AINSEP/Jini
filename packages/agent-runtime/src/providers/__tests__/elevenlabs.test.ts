import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ElevenLabsCredentialMissingError,
  listElevenLabsVoiceOptions,
  type ElevenLabsCredentialResolver,
} from '../elevenlabs.js';

const resolver = (creds: { apiKey: string; baseUrl?: string }): ElevenLabsCredentialResolver =>
  vi.fn().mockResolvedValue(creds);

describe('listElevenLabsVoiceOptions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws ElevenLabsCredentialMissingError when no api key is configured', async () => {
    await expect(listElevenLabsVoiceOptions({ workspaceKey: 'ws-1', resolveCredentials: resolver({ apiKey: '' }) })).rejects.toBeInstanceOf(
      ElevenLabsCredentialMissingError,
    );
  });

  it('fetches and normalizes the voice catalog', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        voices: [
          {
            voice_id: 'v1',
            name: 'Rachel',
            category: 'premade',
            preview_url: 'https://example.com/preview.mp3',
            labels: { accent: 'american', extra: 42, blank: '   ' },
          },
          { voice_id: '', name: 'no-id-skip' },
          { voice_id: 'v2' },
          { voice_id: 'v3', name: 'AllBlankLabels', labels: { blank: '   ', num: 42 } },
          'not-an-object',
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const voices = await listElevenLabsVoiceOptions({ workspaceKey: 'ws-1', resolveCredentials: resolver({ apiKey: 'k1' }) }, { limit: 5 });
    expect(voices).toEqual([
      {
        voiceId: 'v1',
        name: 'Rachel',
        category: 'premade',
        labels: { accent: 'american' },
        previewUrl: 'https://example.com/preview.mp3',
      },
      { voiceId: 'v2', name: 'v2' },
      { voiceId: 'v3', name: 'AllBlankLabels' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.elevenlabs.io/v2/voices?page_size=5',
      expect.objectContaining({ headers: { 'xi-api-key': 'k1', accept: 'application/json' } }),
    );
  });

  it('uses a custom base url and strips a trailing slash', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ voices: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    await listElevenLabsVoiceOptions({ workspaceKey: 'ws-2', resolveCredentials: resolver({ apiKey: 'k1', baseUrl: 'https://custom.example.com/' }) });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://custom.example.com/v2/voices?page_size=100',
      expect.anything(),
    );
  });

  it('clamps an out-of-range or non-numeric limit to the default/bounds', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ voices: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    await listElevenLabsVoiceOptions({ workspaceKey: 'ws-3', resolveCredentials: resolver({ apiKey: 'k1' }) }, { limit: 'oops' as unknown as number });
    expect(fetchMock).toHaveBeenCalledWith('https://api.elevenlabs.io/v2/voices?page_size=100', expect.anything());

    await listElevenLabsVoiceOptions({ workspaceKey: 'ws-3', resolveCredentials: resolver({ apiKey: 'k1' }) }, { limit: 500 });
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://api.elevenlabs.io/v2/voices?page_size=100',
      expect.anything(),
    );

    await listElevenLabsVoiceOptions({ workspaceKey: 'ws-3', resolveCredentials: resolver({ apiKey: 'k1' }) }, { limit: -5 });
    expect(fetchMock).toHaveBeenLastCalledWith('https://api.elevenlabs.io/v2/voices?page_size=1', expect.anything());
  });

  it('throws with the response body on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' }),
    );
    await expect(listElevenLabsVoiceOptions({ workspaceKey: 'ws-4', resolveCredentials: resolver({ apiKey: 'bad' }) })).rejects.toThrow(
      /elevenlabs voices 401: unauthorized/,
    );
  });

  it('returns [] when the payload has no voices array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    await expect(listElevenLabsVoiceOptions({ workspaceKey: 'ws-5', resolveCredentials: resolver({ apiKey: 'k1' }) })).resolves.toEqual([]);
  });

  it('caches results per workspace+baseUrl+pageSize+credential fingerprint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ voices: [{ voice_id: 'v1', name: 'Rachel' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const first = await listElevenLabsVoiceOptions({ workspaceKey: 'ws-cache', resolveCredentials: resolver({ apiKey: 'same-key' }) });
    const second = await listElevenLabsVoiceOptions({ workspaceKey: 'ws-cache', resolveCredentials: resolver({ apiKey: 'same-key' }) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    // Mutating the returned array must not corrupt the cached copy.
    second[0]!.name = 'mutated';
    second[0]!.labels = { x: 'y' };
    const third = await listElevenLabsVoiceOptions({ workspaceKey: 'ws-cache', resolveCredentials: resolver({ apiKey: 'same-key' }) });
    expect(third[0]!.name).toBe('Rachel');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not cache across a different api key (cache key includes a credential fingerprint)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ voices: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    await listElevenLabsVoiceOptions({ workspaceKey: 'ws-fp', resolveCredentials: resolver({ apiKey: 'key-a' }) });
    await listElevenLabsVoiceOptions({ workspaceKey: 'ws-fp', resolveCredentials: resolver({ apiKey: 'key-b' }) });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
