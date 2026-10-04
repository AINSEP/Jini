import type { MediaApiPort, MediaProvidersPort } from '../ports.js';
import type { MediaAsset, UploadInput, MediaRequestOptions, MediaProvider } from '../models.js';
import { queryMedia } from '../rules.js';
export function createMemoryMediaApi(
  { assets = [] }: { assets?: readonly MediaAsset[] },
  { now = () => new Date().toISOString() }: { now?: () => string } = {},
): MediaApiPort {
  const items = new Map(assets.map((item) => [item.id, Object.freeze({ ...item })]));
  let sequence = 0;
  function check(options: MediaRequestOptions) {
    options.signal?.throwIfAborted();
  }
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
    return { byteSize: Math.max(0, Math.floor(input.dataBase64.length * 3 / 4) - (input.dataBase64.match(/=+$/)?.[0].length ?? 0)), contentType: input.contentType, sha256: `memory-content-${++sequence}` };
  }
  return {
    replaceSupported: true,
    restoreSupported: true,
    async list(query, options = {}) {
      check(options);
      return Object.freeze(queryMedia({ media: [...items.values()], query }));
    },
    async upload(input, options = {}) {
      check(options);
      let id: string;
      do {
        id = `memory-${++sequence}`;
      } while (items.has(id));
      const timestamp = now();
      return put({
        id,
        title: options.title ?? input.filename,
        alt: options.alt ?? '',
        caption: options.caption ?? '',
        credit: options.credit ?? '',
        slug: options.slug ?? id,
        width: options.width ?? null,
        height: options.height ?? null,
        cssClass: options.cssClass ?? null,
        htmlAttributes: options.htmlAttributes ?? null,
        status: 'active',
        publicUrl: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        version: 1,
        ...content(input),
      });
    },
    async update({ id, patch }, options = {}) {
      check(options);
      const previous = get(id);
      const metadata = Object.fromEntries(
        Object.entries(patch).filter(
          ([key, value]) =>
            ['title', 'slug', 'alt', 'caption', 'credit', 'width', 'height', 'cssClass', 'htmlAttributes'].includes(key) && value !== undefined,
        ),
      );
      return put({ ...previous, ...metadata, version: previous.version + 1, updatedAt: now() });
    },
    async replace({ id, upload }, options = {}) {
      check(options);
      const previous = get(id);
      if (previous.status !== 'active') throw new Error('Cannot replace trashed media');
      return put({
        ...previous,
        ...content(upload),
        version: previous.version + 1,
        updatedAt: now(),
      });
    },
    async trash({ id }, options = {}) {
      check(options);
      const previous = get(id);
      return put({
        ...previous,
        status: 'trashed',
        publicUrl: null,
        version: previous.version + 1,
        updatedAt: now(),
      });
    },
    async restore({ id }, options = {}) {
      check(options);
      const previous = get(id);
      return put({ ...previous, status: 'active', version: previous.version + 1, updatedAt: now() });
    },
    async delete({ id }, options = {}) {
      check(options);
      if (get(id).status !== 'trashed') throw new Error('Trash media before permanent deletion');
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
  function write(id: string, configured: boolean) {
    const previous = items.get(id);
    if (!previous) throw new Error('Unknown provider');
    const next = Object.freeze({ ...previous, configured });
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
      const previous = items.get(id);
      if (!previous) throw new Error('Unknown provider');
      const next = Object.freeze({ ...previous, baseUrl, model });
      items.set(id, next);
      return next;
    },
    async saveCredential({ id, credential }, options = {}) {
      options.signal?.throwIfAborted();
      if (!credential.trim()) throw new Error('Credential is required');
      return write(id, true);
    },
    async removeCredential({ id }, options = {}) {
      options.signal?.throwIfAborted();
      return write(id, false);
    },
  };
}
