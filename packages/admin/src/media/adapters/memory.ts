import { trimCharsEnd } from '@jini-ai/core/text';
import type { MediaApiPort, MediaProvidersPort } from '../ports.js';
import type {
  MediaAsset,
  UploadInput,
  MediaRequestOptions,
  MediaProvider,
  MediaMetadataPatch,
} from '../models.js';
import { queryMedia } from '../rules.js';
const METADATA_KEYS: readonly string[] = ['title', 'slug', 'alt', 'caption', 'credit', 'width', 'height', 'cssClass', 'htmlAttributes'];
/** Only metadata keys with a defined value; null stays, so a patch can clear a nullable field. */
function pickMetadata({ patch }: { patch: MediaMetadataPatch }): MediaMetadataPatch {
  return Object.fromEntries(Object.entries(patch).filter(([key, value]) => METADATA_KEYS.includes(key) && value !== undefined));
}
/** Decoded length of a base64 string: 3 bytes per 4 chars, minus trailing padding. */
function base64ByteSize({ dataBase64 }: { dataBase64: string }) {
  const padding = dataBase64.length - trimCharsEnd({ text: dataBase64, chars: '=' }).length;
  return Math.max(0, Math.floor(dataBase64.length * 3 / 4) - padding);
}
/** Frozen in-memory asset table plus the sequence-backed id/content helpers the fake API shares. */
function createMemoryMediaStore({ assets }: { assets: readonly MediaAsset[] }) {
  const items = new Map(assets.map((item) => [item.id, Object.freeze({ ...item })]));
  let sequence = 0;
  const nextSequence = () => { sequence += 1; return sequence; };
  function get(id: string) {
    const item = items.get(id);
    if (!item) throw new Error(`Media not found: ${id}`);
    return item;
  }
  function put(item: MediaAsset) {
    const frozen = Object.freeze(item);
    items.set(item.id, frozen);
    return frozen;
  }
  function content(input: UploadInput) {
    // The REAL server ignores the declared string and stores sniffContentType(bytes) instead.
    // This fake has no bytes to sniff — its input is an opaque base64 string a test made up —
    // so it echoes what the caller declared. Tests needing disagreement must seed assets directly.
    return { byteSize: base64ByteSize(input), contentType: input.contentType, sha256: `memory-content-${nextSequence()}` };
  }
  function nextFreeId() {
    let id: string;
    do {
      id = `memory-${nextSequence()}`;
    } while (items.has(id));
    return id;
  }
  return { items, get, put, content, nextFreeId };
}
function buildUploadedAsset(
  { id, input, options, timestamp }: { id: string; input: UploadInput; options: MediaRequestOptions & MediaMetadataPatch; timestamp: string },
): Omit<MediaAsset, 'byteSize' | 'contentType' | 'sha256'> {
  return {
    id,
    title: input.filename,
    alt: '',
    caption: '',
    credit: '',
    slug: id,
    width: null,
    height: null,
    cssClass: null,
    htmlAttributes: null,
    ...pickMetadata({ patch: options }),
    status: 'active',
    publicUrl: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
  };
}
export function createMemoryMediaApi(
  { assets = [] }: { assets?: readonly MediaAsset[] },
  { now = () => new Date().toISOString() }: { now?: () => string } = {},
): MediaApiPort {
  const { items, get, put, content, nextFreeId } = createMemoryMediaStore({ assets });
  const check = (options: MediaRequestOptions) => { options.signal?.throwIfAborted(); };
  const bump = (previous: MediaAsset, patch: Partial<MediaAsset>) =>
    put({ ...previous, ...patch, version: previous.version + 1, updatedAt: now() });
  return {
    replaceSupported: true,
    restoreSupported: true,
    async list(query, options = {}) {
      check(options);
      return Object.freeze(queryMedia({ media: [...items.values()], query }));
    },
    async upload(input, options = {}) {
      check(options);
      const id = nextFreeId();
      return put({ ...buildUploadedAsset({ id, input, options, timestamp: now() }), ...content(input) });
    },
    async update({ id, patch }, options = {}) {
      check(options);
      return bump(get(id), pickMetadata({ patch }));
    },
    async replace({ id, upload }, options = {}) {
      check(options);
      const previous = get(id);
      if (previous.status !== 'active') throw new Error(`Cannot replace trashed media: ${id} (restore it first)`);
      return bump(previous, content(upload));
    },
    async trash({ id }, options = {}) {
      check(options);
      return bump(get(id), { status: 'trashed', publicUrl: null });
    },
    async restore({ id }, options = {}) {
      check(options);
      return bump(get(id), { status: 'active' });
    },
    async delete({ id }, options = {}) {
      check(options);
      if (get(id).status !== 'trashed') throw new Error(`Trash media before permanent deletion: ${id}`);
      items.delete(id);
      return { purged: true };
    },
    // Distinct memory:// scheme so a URL assertion fails if the consumer calls a real client.
    originalUrl: ({ id }) => `memory://media-original/${encodeURIComponent(id)}`,
  };
}
export function createMemoryMediaProviders(
  { providers = [] }: { providers?: readonly MediaProvider[] },
  _optional: Record<string, never> = {},
): MediaProvidersPort {
  const items = new Map(providers.map((item) => [item.id, Object.freeze({ ...item })]));
  function write(id: string, patch: Partial<MediaProvider>) {
    const previous = items.get(id);
    if (!previous) throw new Error(`Unknown media provider: ${id}`);
    const next = Object.freeze({ ...previous, ...patch });
    items.set(id, next);
    return next;
  }
  return {
    async list(_required, options = {}) {
      options.signal?.throwIfAborted();
      return Object.freeze([...items.values()]);
    },
    async saveSettings({ id, baseUrl, model }, options = {}) {
      options.signal?.throwIfAborted();
      return write(id, { baseUrl, model });
    },
    async saveCredential({ id, credential }, options = {}) {
      options.signal?.throwIfAborted();
      if (!credential.trim()) throw new Error(`Credential is required for media provider: ${id}`);
      return write(id, { configured: true });
    },
    async removeCredential({ id }, options = {}) {
      options.signal?.throwIfAborted();
      return write(id, { configured: false });
    },
  };
}
