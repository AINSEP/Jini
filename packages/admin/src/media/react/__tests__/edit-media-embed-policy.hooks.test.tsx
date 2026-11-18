import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, renderHook, waitFor } from '../../../__tests__/fetch-query-support.js';
import { createMemoryMediaApi } from '../../adapters/memory.js';
import type { MediaAsset } from '../../models.js';
import { denyAllEmbedPolicy, realEmbedPolicy } from '../../__tests__/fakes/embed-policy.js';
import { useEditMediaPanel } from '../hooks/EditMediaPanel.hooks.js';
import type { MediaPorts } from '../hooks/MediaPorts.hooks.js';

afterEach(cleanup);

// The live hint is the operator-facing half of the HTML-attribute allow-list: the injected ports decide it.
async function hintFor(required: { htmlAttributes: string; embedPolicy: MediaPorts['embedPolicy'] }, _optional: Record<string, never> = {}) {
  const api = createMemoryMediaApi({});
  const item: MediaAsset = await api.upload({ filename: 'photo.png', contentType: 'image/png', dataBase64: 'aGVsbG8=' });
  const ports: MediaPorts = { mediaApi: api, embedPolicy: required.embedPolicy };
  const { result } = renderHook(() => useEditMediaPanel(
    { api, item: { ...item, htmlAttributes: required.htmlAttributes }, onSaved: () => undefined, onClose: () => undefined },
    { usePorts: () => ports },
  ));
  await waitFor(() => expect(result.current.snapshot).not.toBeNull());
  return result.current.hint;
}

describe('useEditMediaPanel reads its embed policy from the injected ports hook', () => {
  it('shows no hint when the policy accepts the attributes', async () => {
    expect(await hintFor({ htmlAttributes: 'class="hero"', embedPolicy: realEmbedPolicy })).toBeNull();
  });
  it('names the attribute a policy that allows nothing refuses', async () => {
    expect(await hintFor({ htmlAttributes: 'class="hero"', embedPolicy: denyAllEmbedPolicy })).toBe("'class' is not an allowed HTML attribute.");
  });
  it('keeps the server-parser reasons through the real policy', async () => {
    expect(await hintFor({ htmlAttributes: 'onerror="x"', embedPolicy: realEmbedPolicy })).toBe("Event handler attributes like 'onerror' are not allowed.");
  });
});
